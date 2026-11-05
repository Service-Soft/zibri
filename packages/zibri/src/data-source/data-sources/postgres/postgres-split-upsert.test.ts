import { setImmediate as nextTurn } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { PostgresPooler } from './postgres-pooler.model';
import { TestTimeouts } from '../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { DataSource } from '../../decorators/data-source.decorator';
import { SchemaManagement } from '../../models/schema-management.model';
import { RepositoryClass } from '../../repository/repository-class.type';

@Entity({ tenant: 'shared', allowOrphan: true })
class SplitRow extends BaseEntity {
    @Property.string({ unique: true })
    key!: string;

    @Property.string()
    label!: string;
}

/**
 * Binds few enough values per statement that an upsert of a handful of rows is split.
 */
@DataSource()
class SplittingDataSource extends PostgresDataSource {
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false,
        maxBoundValuesPerStatement: 20
    };

    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, SplitRow];

    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;

    schemaManagement: SchemaManagement = 'synchronize';

    readonly pooler: PostgresPooler = 'none';
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [SplittingDataSource] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

// found 2026-10-28 in the heavy run after typeorm went: the statements of a split upsert were all handed to the
// connection of their transaction at once, which the driver queues today and stops doing in pg 9
describe('an upsert split into several statements', () => {
    it('runs them on its transaction one after the other', async () => {
        const warnings: string[] = [];
        const onWarning: (warning: Error) => void = warning => warnings.push(warning.message);
        process.on('warning', onWarning);
        try {
            const rows: SplitRow[] = await inject(SplittingDataSource).getRepository(SplitRow)
                .upsertAll(
                    ['key'],
                    Array.from({ length: 10 }, (_, i) => ({ create: { key: `split-${i}`, label: 'inserted' }, onConflict: { label: { set: 'upserted' } } }))
                );
            // a warning is emitted on the turn after the call that caused it
            await nextTurn();

            expect(rows.map(r => r.key)).toEqual(Array.from({ length: 10 }, (_, i) => `split-${i}`));
            expect(warnings.filter(w => w.includes('already executing a query'))).toEqual([]);
        }
        finally {
            process.off('warning', onWarning);
        }
    });
});