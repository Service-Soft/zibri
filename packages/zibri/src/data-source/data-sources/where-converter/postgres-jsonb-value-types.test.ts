/* eslint-disable unicorn/no-null */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createTestDataSource, defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../../di/inject.function.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Entity } from '../../../entity/decorators/entity.decorator.ts';
import { Property } from '../../../entity/decorators/property.decorator.ts';
import { Newable } from '../../../types/newable.type.ts';
import { Repository } from '../../repository/repository.ts';
import { StoredValueTypeMismatchError } from '../../stored-value-type-mismatch.error.ts';
import { PostgresDataSource } from '../postgres/postgres-typeorm-data-source.model.ts';

/**
 * What a filter on a JSON column says about the values inside it.
 *
 * A JSON column is the one place where what a row holds can disagree with what the model declares,
 * because nothing in the schema enforces the shape: a key can be missing, hold null, or hold a value
 * of the wrong type entirely. Both of those are asked here through the data source that has the
 * distinction to get wrong - the other one holds an entity as one document, so it has neither a
 * separate column type nor a way to tell an absent key from a null one.
 */

class Reading {
    @Property.number({ required: false })
    value: number | undefined | null;

    @Property.string({ required: false })
    note: string | undefined | null;
}

@Entity({ tenant: 'shared' })
class Sensor extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Reading, required: false })
    reading: Reading | undefined | null;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Sensor]
});

describe('a filter on a JSON column', () => {
    let server: StartedTestServer;
    let sensorRepo: Repository<Sensor>;
    let dataSource: PostgresDataSource;

    /**
     * Writes the column past the framework, so that what the row holds is exactly what is written.
     *
     * The point of every case here is a value the model would not have produced, and going through
     * the repository to create one would mean asking validation to let it past - which would test
     * the way in rather than the way out.
     * @param name - The sensor to write to.
     * @param json - The json the reading column should hold afterwards.
     */
    async function writeReading(name: string, json: string): Promise<void> {
        await dataSource.query(Sensor).connection.query(
            'UPDATE sensor SET reading = $1::jsonb WHERE name = $2',
            [json, name]
        );
    }

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        sensorRepo = inject(repositoryTokenFor(Sensor));
        dataSource = inject(dataSourceClass);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await sensorRepo.deleteAll({});
        await sensorRepo.create({ name: 'has-value', reading: { value: 5, note: 'ok' } });
        await sensorRepo.create({ name: 'holds-null', reading: { value: 1, note: 'ok' } });
        await sensorRepo.create({ name: 'no-key', reading: { value: 1, note: 'ok' } });
        await sensorRepo.create({ name: 'no-reading', reading: null });
        await writeReading('holds-null', '{"value":null,"note":"ok"}');
        await writeReading('no-key', '{"note":"ok"}');
    });

    describe('null inside the column', () => {
        it('reads a key that is absent and a key that holds null as the same thing', async () => {
            const res: Sensor[] = await sensorRepo.findAll({ where: { reading: { where: { value: null } } } });
            expect(res.map(s => s.name).sort()).toEqual(['holds-null', 'no-key']);
        });

        it('answers "not null" with exactly the rows that have a reading and are not in "null"', async () => {
            const isNull: Sensor[] = await sensorRepo.findAll({ where: { reading: { where: { value: null } } } });
            const notNull: Sensor[] = await sensorRepo.findAll({ where: { reading: { where: { value: { not: null } } } } });

            expect(notNull.map(s => s.name)).toEqual(['has-value']);
            // the two are a partition of the rows that have a reading at all: each of those answers
            // exactly one of the two questions. A row holding json null used to answer both at once
            const withReading: Sensor[] = await sensorRepo.findAll({ where: { reading: { not: null } } });
            expect([...isNull, ...notNull].map(s => s.id).sort()).toEqual(withReading.map(s => s.id).sort());
        });

        it('answers neither for a row whose column holds no object to ask about', async () => {
            // a question about a property of a reading is not a question a sensor without one answers,
            // which is what the other data source says as well: it refuses a nested filter outright
            // when the object it reaches into is missing
            const isNull: Sensor[] = await sensorRepo.findAll({ where: { reading: { where: { value: null } } } });
            const notNull: Sensor[] = await sensorRepo.findAll({ where: { reading: { where: { value: { not: null } } } } });

            expect([...isNull, ...notNull].map(s => s.name)).not.toContain('no-reading');
        });
    });

    describe('a value that contradicts the type the model declares', () => {
        beforeEach(async () => {
            await writeReading('no-key', '{"value":"not-a-number","note":"ok"}');
        });

        // what every data source answers alike is in mistyped-values.cases.ts. This one is about the
        // statement the database refused, which only a data source running one has
        it('keeps the failed query readable as the cause', async () => {
            const raised: unknown = await sensorRepo.findAll({ where: { reading: { where: { value: { greaterThan: 1 } } } } })
                .then(() => undefined, (error: unknown) => error);

            expect(raised).toBeInstanceOf(StoredValueTypeMismatchError);
            expect(raised instanceof Error ? raised.cause : undefined).toBeInstanceOf(Error);
        });
    });
});