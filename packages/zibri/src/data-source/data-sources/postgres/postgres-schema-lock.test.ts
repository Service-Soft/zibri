import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { Pg, PgSessionClient } from './postgres-client.model';
import { PostgresDataSource, PostgresOptions } from './postgres-data-source.model';
import { TestServerTimeouts, TestTimeouts } from '../../../__testing__/constants';
import { holdUntilLetGo } from '../../../__testing__/hold-until-let-go.function';
import { createTestDataSource } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../../__testing__/wait-until.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { optionalPeer } from '../../../utilities/optional-peer.function';
import { PromiseUtilities } from '../../../utilities/promise.utilities';
import { SCHEMA_LOCK_KEY } from '../data-source.interface';

/**
 * How long the index built beside the waiting instance may take, which an empty table needs a
 * fraction of.
 */
const BUILD_TIMEOUT_IN_MS: number = 5000;

/**
 * The schema of another application on the same database.
 */
const OTHER_APPLICATION_SCHEMA: string = 'other_application';

const timeouts: TestServerTimeouts = TestTimeouts.postgres;

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

/**
 * The data source of another instance or another application, holding the schema lock the way it
 * does while it sets its schema up.
 */
class LockHoldingDataSource extends createTestDataSource({ entities: [], allowOrphan: true }) {
    /**
     * Holds the schema lock while the given function runs.
     * @param whileHeld - What runs while it is held.
     */
    async holdSchemaLock(whileHeld: () => Promise<void>): Promise<void> {
        await this.schemaLock(SCHEMA_LOCK_KEY, whileHeld);
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, timeouts.start);

afterAll(async () => {
    await server?.shutdown();
}, timeouts.shutdown);

/**
 * Opens a connection of its own to the database of the data source, as another instance has.
 * @returns The connection, open.
 */
async function connectAsAnotherInstance(): Promise<PgSessionClient> {
    const options: PostgresOptions = inject(dataSourceClass).options;
    const pg: Pg = optionalPeer<Pg>('pg', 'Connecting as another instance');
    const client: PgSessionClient = new pg.Client({
        host: options.host,
        port: options.port,
        user: options.username,
        password: options.password?.toString(),
        database: options.database
    });
    await client.connect();
    return client;
}

/**
 * Builds the data source of something else connecting to the database of the data source.
 * @param schema - The schema it keeps its tables in, the data source's own when not given.
 * @returns The data source, which needs no setup to hold the schema lock.
 */
function createLockHolder(schema?: string): LockHoldingDataSource {
    const holder: LockHoldingDataSource = new LockHoldingDataSource();
    holder.options = { ...inject(dataSourceClass).options, ...schema == undefined ? {} : { schema } };
    return holder;
}

// the cluster run of evaluation 01 C2 hung on this: the instance setting the schema up built an index
// concurrently, which waits for every transaction holding an older snapshot, and the instances
// waiting for the schema lock each held one for as long as they waited - for the instance holding it.
// Postgres sees no deadlock in that, since the instance holding the lock waits in the application
describe('instances waiting for the schema setup of another', () => {
    it('let the instance setting it up build an index concurrently', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        const client: PgSessionClient = await connectAsAnotherInstance();
        const letGo: () => Promise<void> = await holdUntilLetGo(async whileHeld => await createLockHolder().holdSchemaLock(whileHeld));
        try {
            const restarted: Promise<void> = server.reInit();
            // once the restarting instance asked for the lock as well as the one holding it
            await waitUntil(async () => (await client.query(
                'SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND query LIKE $1',
                ['%advisory_lock%']
            )).rows.length > 1);

            await client.query(`SET statement_timeout = ${BUILD_TIMEOUT_IN_MS}`);
            await expect(client.query('CREATE INDEX CONCURRENTLY "zi_schema_lock_probe" ON "migration_entity" ("version")')).resolves.toBeDefined();

            await letGo();
            await restarted;
        }
        finally {
            await letGo();
            // a build that was canceled leaves the index behind, invalid
            await client.query('DROP INDEX IF EXISTS "zi_schema_lock_probe"');
            await client.end();
        }
    }, timeouts.restart + BUILD_TIMEOUT_IN_MS);
});

// evaluation round 2, 02 §S12: the lock was one per database, so an application in a schema of its
// own waited for every other one setting up its schema, and gave up after the schema lock timeout
describe('applications sharing a database, each in a schema of its own', () => {
    it('set their schemas up without waiting for each other', async () => {
        if (server == undefined) {
            throw new Error('the server did not start');
        }
        const client: PgSessionClient = await connectAsAnotherInstance();
        await client.query(`CREATE SCHEMA IF NOT EXISTS "${OTHER_APPLICATION_SCHEMA}"`);
        await client.end();

        const letGo: () => Promise<void> = await holdUntilLetGo(
            async whileHeld => await createLockHolder(OTHER_APPLICATION_SCHEMA).holdSchemaLock(whileHeld)
        );
        const restarted: Promise<void> = server.reInit();
        try {
            await expect(PromiseUtilities.withTimeout(async () => await restarted, timeouts.restart)).resolves.toBeUndefined();
        }
        finally {
            await letGo();
            await restarted;
        }
    }, 2 * timeouts.restart);
});