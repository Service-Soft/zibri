import assert from 'node:assert';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { connectAsAnotherInstance } from '../../../__testing__/connect-as-another-instance.function';
import { TestTimeouts } from '../../../__testing__/constants';
import { queryPostgres } from '../../../__testing__/query-postgres.function';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../../__testing__/wait-until.function';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { MetadataUtilities } from '../../../utilities/metadata.utilities';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';
import { PgSessionClient } from './postgres-client.model';
import { PostgresDataSource } from './postgres-data-source.model';

// postgres indexes the key a foreign key refers to, never the column holding it: deleting a row checked, or
// cascaded to, the rows pointing at it by reading the whole table they are in, once for every row deleted.
// Deleting n rows pointed at from a table of m rows cost n x m, which a restore of a tenant deleting its
// change sets ran into the statement timeout with

@Entity({ tenant: 'shared', allowOrphan: true })
class Warehouse extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Crate, inverseSide: 'warehouse' })
    crates!: Crate[];

    @Property.oneToMany({ target: () => Pallet, inverseSide: 'warehouse' })
    pallets!: Pallet[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Crate extends BaseEntity {
    @Property.manyToOne({ target: () => Warehouse, joinColumn: 'warehouseId', inverseSide: 'crates', cascade: ['remove'] })
    warehouse!: Warehouse;

    @Property.string({ format: 'uuid' })
    warehouseId!: string;
}

/**
 * Holds an index of its own starting with the column of its key, which needs no second one.
 */
@Entity({ tenant: 'shared', allowOrphan: true, indexes: [['warehouseId', 'label']] })
class Pallet extends BaseEntity {
    @Property.string()
    label!: string;

    @Property.manyToOne({ target: () => Warehouse, joinColumn: 'warehouseId', inverseSide: 'pallets' })
    warehouse!: Warehouse;

    @Property.string({ format: 'uuid' })
    warehouseId!: string;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Warehouse, Crate, Pallet],
    repositories: defaultTestServerRepositories
});

/**
 * How many rows are deleted, each pointed at from the other table, or able to be.
 */
const DELETED: number = 30;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.postgres.shutdown);

/**
 * The table of an entity.
 * @param entity - The entity.
 * @returns Its name.
 */
function tableOf(entity: Newable<BaseEntity>): string {
    return MetadataUtilities.getEntityMetadata(entity)?.tableName ?? '';
}

/**
 * How many indexes of a table start with a column.
 * @param table - The table.
 * @param column - The column.
 * @returns How many.
 */
async function countIndexesStartingWith(table: string, column: string): Promise<number> {
    const [row] = await queryPostgres(
        inject(dataSourceClass),
        'SELECT count(*)::int AS "count" FROM pg_catalog.pg_index i'
        + ' JOIN pg_catalog.pg_class c ON c.oid = i.indrelid'
        + ' JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]'
        + ' WHERE c.relname = $1 AND a.attname = $2 AND c.relnamespace = pg_catalog.to_regnamespace(current_schema())',
        [table, column]
    );
    return Number(row?.['count']);
}

describe('a foreign key of a relation to one row', () => {
    it('deletes rows pointed at without reading the table pointing at them once for each', async () => {
        const dataSource: PostgresDataSource = inject(dataSourceClass);
        const warehouses: Repository<Warehouse> = dataSource.getRepository(Warehouse);
        const kept: Warehouse[] = await warehouses.createAll(Array.from({ length: 10 }, (_, i) => ({ name: `kept ${i}` })));
        const deleted: Warehouse[] = await warehouses.createAll(Array.from({ length: DELETED }, (_, i) => ({ name: `deleted ${i}` })));
        // enough rows that reading them by a key beats reading them all, as a table worth an index holds
        await dataSource.getRepository(Crate).createAll(Array.from({ length: 4000 }, (_, i) => ({ warehouseId: kept[i % kept.length]?.id ?? '' })));
        await queryPostgres(dataSource, `ANALYZE "${tableOf(Crate)}"`);

        const transaction: Transaction = await dataSource.startTransaction();
        let scans: number;
        try {
            await warehouses.deleteAll({ id: { oneOf: deleted.map(w => w.id) } }, { transaction });
            // what this transaction read so far, the reads of the foreign key's triggers included
            const [read] = await queryPostgres(
                dataSource,
                'SELECT coalesce(seq_scan, 0)::int AS "scans" FROM pg_catalog.pg_stat_xact_user_tables WHERE relname = $1 AND schemaname = current_schema()',
                [tableOf(Crate)],
                transaction
            );
            scans = Number(read?.['scans'] ?? 0);
        }
        finally {
            await transaction.rollback();
        }

        expect(scans).toBeLessThan(DELETED);
        expect(await countIndexesStartingWith(tableOf(Crate), 'warehouseId')).toBe(1);
    }, 60000);

    it('adds no index beside one the entity declares starting with the same column', async () => {
        expect(await countIndexesStartingWith(tableOf(Pallet), 'warehouseId')).toBe(1);
    });
});

/**
 * The indexes of a table starting with a column, as another instance lists them.
 * @param client - The connection of the other instance.
 * @param table - The table.
 * @param column - The column.
 * @returns Their names.
 */
async function findIndexesStartingWith(client: PgSessionClient, table: string, column: string): Promise<string[]> {
    const listed: { rows: Record<string, unknown>[] } = await client.query(
        'SELECT x.relname AS "name" FROM pg_catalog.pg_index i'
        + ' JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid'
        + ' JOIN pg_catalog.pg_class c ON c.oid = i.indrelid'
        + ' JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = i.indkey[0]'
        + ' WHERE c.relname = $1 AND a.attname = $2 AND c.relnamespace = pg_catalog.to_regnamespace(current_schema())',
        [table, column]
    );
    return listed.rows.map(row => String(row['name']));
}

/**
 * The comment a build of 3.0 marks the indexes it keeps with, and counts an index as its own by.
 */
const COMMENT_OF_3_0: string = 'Kept by zibri as an entity declares it, and dropped once none does.';

// a build of 3.0 dropped the index of the column of a relation, which its entities do not declare, as it carried the
// comment of the indexes 3.0 keeps, and the next start of 3.1 built it again
describe('the indexes kept beside a build of 3.0', () => {
    it('are marked so that a build of 3.0 counts none of them as its own', async () => {
        const [index] = await queryPostgres(
            inject(dataSourceClass),
            'SELECT obj_description(x.indexrelid, \'pg_class\') AS "comment" FROM pg_catalog.pg_index x'
            + ' JOIN pg_catalog.pg_class c ON c.oid = x.indrelid'
            + ' JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.indkey[0]'
            + ' WHERE c.relname = $1 AND a.attname = $2 AND c.relnamespace = pg_catalog.to_regnamespace(current_schema())',
            [tableOf(Crate), 'warehouseId']
        );

        expect(index?.['comment']).toEqual(expect.stringContaining('Kept by zibri'));
        expect(index?.['comment']).not.toBe(COMMENT_OF_3_0);
    });

    it('count an index a build of 3.0 marked as their own, and drop it once no entity declares it', async () => {
        assert(server);
        const dataSource: PostgresDataSource = inject(dataSourceClass);
        await queryPostgres(dataSource, `CREATE INDEX "zi_kept_by_3_0" ON "${tableOf(Warehouse)}" ("name")`);
        await queryPostgres(dataSource, `COMMENT ON INDEX "zi_kept_by_3_0" IS '${COMMENT_OF_3_0}'`);
        // by its name rather than by its column, which holds a trigram index as well where pg_trgm is installed. Through
        // the data source injected at the time: the restart replaces it, and ends the pool of the one before
        const isStored: () => Promise<boolean> = async () => {
            const [found] = await queryPostgres(inject(dataSourceClass), 'SELECT to_regclass($1) IS NOT NULL AS "stored"', ['zi_kept_by_3_0']);
            return found?.['stored'] === true;
        };
        expect(await isStored()).toBe(true);

        await server.reInit();

        expect(await isStored()).toBe(false);
    }, TestTimeouts.postgres.restart);
});

// a start built every index before it listened: on a large table minutes, which an orchestrator restarting it as
// unresponsive cut short over and over
describe('an index that only makes reads faster', () => {
    it('is built once the start is done, by the instance holding the lock of the builds, which the start waits for none of', async () => {
        assert(server);
        const client: PgSessionClient = await connectAsAnotherInstance(inject(dataSourceClass));
        const crates: string = tableOf(Crate);
        for (const name of await findIndexesStartingWith(client, crates, 'warehouseId')) {
            await client.query(`DROP INDEX "${name}"`);
        }
        // what an instance building them holds
        await client.query('SELECT pg_advisory_lock(hashtext(coalesce(current_schema(), \'\') || \':\' || $1))', ['zibri.index-builds']);
        let restarted: Promise<void> | undefined;
        try {
            restarted = server.reInit();
            // once the restarted instance is done starting, and its build asks for the lock
            await waitUntil(async () => (await client.query(
                'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE $1',
                ['%indexBuildsTaken%']
            )).rows.length > 0);

            expect(await findIndexesStartingWith(client, crates, 'warehouseId')).toEqual([]);
        }
        finally {
            await client.end();
        }
        await restarted;

        expect(await countIndexesStartingWith(crates, 'warehouseId')).toBe(1);
        expect(server.bootLog.join('\n')).toContain(`Built the indexes of "${dataSourceClass.name}" its start left`);
    }, TestTimeouts.postgres.restart * 2);

    // a build takes minutes on a large table, which a shutdown waiting for it spent past the grace period an
    // orchestrator gives it, and was killed in the middle of anyway
    it('is ended by a shutdown, which waits for no build, and built by the next start', async () => {
        assert(server);
        const client: PgSessionClient = await connectAsAnotherInstance(inject(dataSourceClass));
        const crates: string = tableOf(Crate);
        let restarted: Promise<void> | undefined;
        try {
            for (const name of await findIndexesStartingWith(client, crates, 'warehouseId')) {
                await client.query(`DROP INDEX "${name}"`);
            }
            // the lock of the builds first, so that the start is done before anything holds the table: the start
            // takes locks of its own on it
            const buildsLock: string = 'hashtext(coalesce(current_schema(), \'\') || \':\' || $1)';
            await client.query(`SELECT pg_advisory_lock(${buildsLock})`, ['zibri.index-builds']);
            restarted = server.reInit();
            await waitUntil(async () => (await client.query(
                'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE $1',
                ['%indexBuildsTaken%']
            )).rows.length > 0, TestTimeouts.postgres.restart);
            // then what a concurrent build waits for as long as it is held: a lock of the table conflicting with the
            // one it builds under. Taken before the lock of the builds is let go of, which the build takes next
            await client.query('BEGIN');
            await client.query(`LOCK TABLE "${crates}" IN SHARE MODE`);
            await client.query(`SELECT pg_advisory_unlock(${buildsLock})`, ['zibri.index-builds']);
            const findBuildsWaiting: () => Promise<unknown[]> = async () => {
                // read inside the transaction holding the table, in which postgres answers what it read of the
                // activity the first time, until it is told to forget it
                await client.query('SELECT pg_stat_clear_snapshot()');
                return (await client.query(
                    'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()'
                    + ' AND wait_event_type = \'Lock\' AND query LIKE $1',
                    ['CREATE INDEX CONCURRENTLY%']
                )).rows;
            };
            await waitUntil(async () => (await findBuildsWaiting()).length > 0, TestTimeouts.postgres.restart);
            // eslint-disable-next-line typescript/typedef
            const errorSpy = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

            // within the time rather than for as long as the lock is held, which is until this test lets go of it
            await PromiseUtilities.withTimeout(async () => await server?.['app'].shutdown(), TestTimeouts.postgres.shutdown);
            await restarted;

            expect(await findBuildsWaiting()).toEqual([]);
            expect(await findIndexesStartingWith(client, crates, 'warehouseId')).toEqual([]);
            // ending the build is what a shutdown does, and nothing that failed
            expect(errorSpy).not.toHaveBeenCalled();
        }
        finally {
            await client.query('ROLLBACK').catch(() => undefined);
            await client.end();
            await restarted?.catch(() => undefined);
        }

        await server.reInit();

        expect(await countIndexesStartingWith(crates, 'warehouseId')).toBe(1);
    }, TestTimeouts.postgres.restart * 3);
});