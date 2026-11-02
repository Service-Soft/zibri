import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-data-source.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../../utilities/uuid.utilities';
import { Repository } from '../../repository/repository';
import { SpanningTransaction } from '../../transaction/spanning-transaction.model';
import { Transaction } from '../../transaction/transaction.model';

/**
 * Written by a trigger of the application's own.
 */
@Entity({ tenant: 'shared' })
class TriggeredEntry extends BaseEntity {
    @Property.string()
    name!: string;
}

/**
 * Pointed at by a foreign key of the application's own, which removes the rows pointing at a row
 * removed.
 */
@Entity({ tenant: 'shared' })
class ReferencedEntry extends BaseEntity {
    @Property.string()
    name!: string;
}

/**
 * Changed by nothing but its own writes.
 */
@Entity({ tenant: 'shared' })
class PlainEntry extends BaseEntity {
    @Property.string()
    name!: string;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TriggeredEntry, ReferencedEntry, PlainEntry],
    repositories: defaultTestServerRepositories
});

/**
 * The table an entity is stored in.
 * @param entityClass - The entity.
 * @returns Its table.
 */
function tableOf(entityClass: Newable<BaseEntity>): string {
    return String(MetadataUtilities.getEntityMetadata(entityClass)?.tableName);
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: PostgresDataSource = inject(dataSourceClass);
    // what a migration of the application would add, which the schema of its entities knows nothing of
    await queryPostgres(dataSource, 'CREATE OR REPLACE FUNCTION zi_test_keep_row() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
    await queryPostgres(dataSource, `DROP TRIGGER IF EXISTS triggered_entry_kept ON "${tableOf(TriggeredEntry)}"`);
    await queryPostgres(
        dataSource,
        `CREATE TRIGGER triggered_entry_kept BEFORE INSERT ON "${tableOf(TriggeredEntry)}" FOR EACH ROW EXECUTE FUNCTION zi_test_keep_row()`
    );
    await queryPostgres(
        dataSource,
        `CREATE TABLE IF NOT EXISTS app_note (id uuid PRIMARY KEY, entry_id uuid REFERENCES "${tableOf(ReferencedEntry)}"(id) ON DELETE CASCADE)`
    );
    // started again, as the application is once the migration ran
    await server.reInit();
}, TestTimeouts.postgres.start + TestTimeouts.postgres.restart);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

describe('a spanning transaction writing to postgres', () => {
    it('is refused a table with a trigger of the application, and says which', async () => {
        const repository: Repository<TriggeredEntry> = inject(dataSourceClass).getRepository(TriggeredEntry);
        const transaction: SpanningTransaction = new SpanningTransaction();

        try {
            await expect(repository.create({ name: UUIDUtilities.generate() }, { transaction }))
                .rejects.toThrow(/TriggeredEntry[\S\s]*the trigger "triggered_entry_kept"/);
        }
        finally {
            await transaction.rollback();
        }
    });

    it('is refused a table a foreign key of the application changes rows on removal from, and says which', async () => {
        const repository: Repository<ReferencedEntry> = inject(dataSourceClass).getRepository(ReferencedEntry);
        const transaction: SpanningTransaction = new SpanningTransaction();

        try {
            await expect(repository.create({ name: UUIDUtilities.generate() }, { transaction }))
                .rejects.toThrow(/ReferencedEntry[\S\s]*the foreign key "app_note_entry_id_fkey" of "app_note"/);
        }
        finally {
            await transaction.rollback();
        }
    });

    it('takes a table only its own writes change, the framework\'s own relations included', async () => {
        const plain: Repository<PlainEntry> = inject(dataSourceClass).getRepository(PlainEntry);
        const name: string = UUIDUtilities.generate();
        const transaction: SpanningTransaction = new SpanningTransaction();

        await plain.create({ name }, { transaction });
        await transaction.commit();

        expect(await plain.findOne({ where: { name } })).toMatchObject({ name });
    });

    it('leaves a transaction of the data source free to write to a refused table', async () => {
        const dataSource: PostgresDataSource = inject(dataSourceClass);
        const repository: Repository<TriggeredEntry> = dataSource.getRepository(TriggeredEntry);
        const name: string = UUIDUtilities.generate();
        const transaction: Transaction = await dataSource.startTransaction();

        await repository.create({ name }, { transaction });
        await transaction.commit();

        expect(await repository.findOne({ where: { name } })).toMatchObject({ name });
    });
});