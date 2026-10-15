import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, SchemaManagement } from 'zibri';

import { zibriFrameworkEntities } from './framework-entities';

/**
 * What can be configured about a data source built by {@link createPostgresTestDataSource}.
 */
export type CreatePostgresTestDataSourceOptions = {
    /**
     * The application's own entities. The framework's are added for you.
     */
    entities?: Newable<BaseEntity>[],
    /**
     * The host to connect to. The port is the one the container was mapped to, and is applied by
     * the harness rather than named here.
     */
    host?: string,
    /**
     * The user to connect as. The harness creates it as a role that owns `database` and has no other
     * privilege.
     */
    username?: string,
    /**
     * The password to connect with.
     */
    password?: string,
    /**
     * The database to connect to.
     */
    database?: string,
    /**
     * Whether the built class may exist without an application using it.
     *
     * Needed by a test that builds more than one and hands an application just one of them.
     */
    allowOrphan?: boolean,
    /**
     * How many connections the data source may hold at once. Left at the framework default unless a
     * test is about the pool itself.
     */
    poolSize?: number,
    /**
     * How long acquiring a connection may wait before it gives up. Set alongside a small `poolSize`
     * so a pool with nothing left to hand out reports that rather than leaving the caller waiting.
     */
    connectionTimeoutInMs?: number
};

/**
 * Builds a postgres data source class for a container the harness starts.
 *
 * What an in process data source cannot do: several processes sharing one store. A cluster needs a
 * real server for that, which is why this rather than createInMemoryDataSource is what a
 * cluster boots on.
 * @param options - The application's entities, the credentials, and how the pool behaves.
 * @returns A data source class, ready to hand to `startTestServer` or `startTestCluster`.
 */
export function createPostgresTestDataSource(options: CreatePostgresTestDataSourceOptions = {}): Newable<PostgresDataSource> {
    const {
        entities = [],
        host = 'localhost',
        username = 'postgres',
        password = 'password',
        database = 'db',
        allowOrphan = false,
        poolSize,
        connectionTimeoutInMs
    } = options;

    // a set, because an application that declares one of the framework's entities itself would
    // otherwise declare it twice
    const all: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...entities])];

    /**
     * The data source this call stands for. A class per call, because a data source is identified
     * by its class and two applications must not share one.
     */
    @DataSource({ allowOrphan })
    class TestPostgresDataSource extends PostgresDataSource {
        override options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
            host,
            username,
            password,
            database,
            // the container serves no tls
            ssl: false,
            // spread rather than assigned, because an explicit undefined would take the framework
            // default away instead of leaving it in place
            ...poolSize != undefined ? { poolSize } : {},
            ...connectionTimeoutInMs != undefined ? { extra: { connectionTimeoutMillis: connectionTimeoutInMs } } : {}
        };

        override entities: Newable<BaseEntity>[] = all;

        // a harness ships no migrations and needs tables, so this is the one deployment shape it is
        // actually right for
        override schemaManagement: SchemaManagement = 'synchronize';
    }

    return TestPostgresDataSource;
}