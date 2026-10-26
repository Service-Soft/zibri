import type { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ExecResult, StartedNetwork, StartedTestContainer } from 'testcontainers';
import { DataSourceInterface, inject, Newable, OmitStrict, optionalPeer, PostgresDataSource, PostgresOptions, PostgresPooler, PostgresTransactionPooler, ValKeyDataSource, ValKeyOptions } from 'zibri';
import { DiContainer } from 'zibri/internal';

import { settleAfterFailure } from './settle-after-failure.function';

/**
 * The postgres image every container backed test runs against.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';

/**
 * The superuser a postgres container is created with. Only the harness connects as it, to create the
 * role the data source connects as.
 */
const POSTGRES_PROVISIONING_USER: string = 'zibri_testing_provisioner';

/**
 * The valkey image every container backed test runs against.
 */
export const VALKEY_TEST_IMAGE: string = 'valkey/valkey:8-alpine';

/**
 * The port valkey listens on inside its container.
 */
export const VALKEY_PORT: number = 6379;

/**
 * The image PgBouncer runs in, in front of the postgres container of a data source behind a
 * transaction pooler: alpine, with the distribution's own package installed as the container starts.
 */
export const PGBOUNCER_TEST_IMAGE: string = 'alpine:3.22';

/**
 * The port PgBouncer listens on inside its container.
 */
const PGBOUNCER_PORT: number = 6432;

/**
 * The name the postgres container has on the network it shares with PgBouncer.
 */
const POSTGRES_NETWORK_ALIAS: string = 'postgres';

/**
 * Where PgBouncer's configuration is copied to, apart from where its package puts its own.
 */
const PGBOUNCER_CONFIG_DIRECTORY: string = '/etc/zibri-pgbouncer';

/**
 * The label naming the process that started a container, by its pid.
 *
 * The session label testcontainers sets is shared by every process of a run, so it cannot say which
 * suite a container still running belongs to; this one narrows it to the worker that started it.
 */
export const CONTAINER_PROCESS_LABEL: string = 'zibri-testing.process';

/**
 * What the container packages are needed for, as a missing one names it.
 */
const CONTAINERS_FEATURE: string = 'Starting a container for a data source';

/**
 * Any data source a test harness knows how to start a container for.
 */
export type TestDataSource = PostgresDataSource | ValKeyDataSource;

/**
 * The host ports a data source is pointed at once its containers run.
 */
export type DataSourcePorts = {
    /**
     * Where the data source's `options` point: its server, or the pooler in front of it.
     */
    port: number,
    /**
     * Where the server itself is, for a data source behind a transaction pooler.
     */
    directPort: number | undefined
};

/**
 * The pooler started in front of the server of a data source, and the network the two share.
 */
export type StartedPooler = {
    /**
     * The running pooler.
     */
    container: StartedTestContainer,
    /**
     * The network the pooler reaches the server on.
     */
    network: StartedNetwork
};

/**
 * A container that was started for one data source class.
 */
export type StartedDataSourceContainer = {
    /**
     * The data source class the container was started for.
     */
    dataSourceClass: Newable<DataSourceInterface>,
    /**
     * The running container of its server.
     */
    container: StartedTestContainer,
    /**
     * The host ports the data source is pointed at.
     */
    ports: DataSourcePorts,
    /**
     * The pooler in front of the server, for a data source behind a transaction pooler.
     */
    pooler: StartedPooler | undefined
};

/**
 * Stops what was started for one data source: its pooler, its server and the network between them.
 * @param started - What was started.
 */
export async function stopDataSourceContainer(started: StartedDataSourceContainer): Promise<void> {
    await started.pooler?.container.stop();
    await started.container.stop();
    await started.pooler?.network.stop();
}

/**
 * Whether the given data source needs a server of its own to talk to.
 *
 * An in process data source does not, and neither does anything a consumer writes against
 * {@link DataSourceInterface} - so a harness that started a container per declared data source would
 * be starting one for something that never opens a socket.
 * @param dataSource - The data source to judge.
 * @returns Whether a container has to be started before this data source can connect.
 */
export function needsContainer(dataSource: DataSourceInterface): dataSource is TestDataSource {
    return dataSource instanceof PostgresDataSource || dataSource instanceof ValKeyDataSource;
}

/**
 * Builds the given data sources ahead of the application's initialization, awaiting whatever
 * asynchronous provider they read - a password from a vault, say. `inject` hands them out from then on.
 * @param dataSourceClasses - The data source classes to build.
 */
export async function buildDataSources(dataSourceClasses: Newable<DataSourceInterface>[]): Promise<void> {
    // one after the other: an asynchronous provider is awaited once, and two builds running at once
    // could both find it not awaited yet
    for (const dataSourceClass of dataSourceClasses) {
        await DiContainer.getInstance().injectAsync(dataSourceClass);
    }
}

/**
 * Applies the ports that the containers of the given data source got mapped to.
 * @param dataSource - The data source to apply the ports to.
 * @param ports - The mapped ports of its containers.
 */
export function applyContainerPorts(dataSource: TestDataSource, ports: DataSourcePorts): void {
    const port: number = ports.port;
    // the one place the harness writes past a `readonly`, on purpose. An application states its
    // connection when the class is built - from its environment, in the scaffold - and `readonly`
    // says exactly that. What a container adds is a port known only once it runs, which is after
    // the class was built and before it connects, and connection options are read on connect. The
    // alternatives were an options hook in the framework that no application asks for, or refusing
    // every data source class a suite or a consumer declares itself; both cost more than one write
    // with an owner. Called before every connect: on start, on reInit, and in each cluster instance.
    if (dataSource instanceof ValKeyDataSource) {
        // eslint-disable-next-line typescript/no-unnecessary-type-assertion
        (dataSource.options as ValKeyOptions) = { ...dataSource.options, port };
        return;
    }
    (dataSource.options as OmitStrict<PostgresOptions, 'type'>) = { ...dataSource.options, port };
    // the server itself is a second address, known as late as the first
    const pooler: PostgresTransactionPooler | undefined = findTransactionPooler(dataSource);
    if (pooler != undefined && ports.directPort != undefined) {
        (dataSource.pooler as PostgresPooler) = { ...pooler, direct: { ...pooler.direct, port: ports.directPort } };
    }
}

/**
 * The transaction pooler a postgres data source declares, if it declares one.
 * @param dataSource - The data source.
 * @returns The pooler, or undefined when every connection of it is a session of its own.
 */
function findTransactionPooler(dataSource: PostgresDataSource): PostgresTransactionPooler | undefined {
    return typeof dataSource.pooler === 'object' ? dataSource.pooler : undefined;
}

/**
 * Creates the role and the database the given data source connects with, the way a managed postgres
 * hands them to an application: a login role that owns its database and holds no other privilege.
 * @param container - The started container, whose superuser runs the statements.
 * @param dataSource - The data source whose credentials and database are created.
 * @throws When a statement is refused, naming what postgres said.
 */
async function provisionApplicationRole(container: StartedPostgreSqlContainer, dataSource: PostgresDataSource): Promise<void> {
    // an application running as the superuser is an application nobody deploys, and a suite running
    // as one cannot see anything that needs a privilege the application would not have - a boot that
    // installs an extension, a backup that reads the cluster. Written out rather than left to the
    // defaults of CREATE ROLE, so the statement is the contract
    const role: string = quoteIdentifier(dataSource.options.username ?? 'postgres');
    const password: string = quoteLiteral(dataSource.options.password?.toString() ?? 'password');
    const database: string = quoteIdentifier(dataSource.options.database ?? 'db');
    const result: ExecResult = await container.exec([
        'psql',
        '--username',
        POSTGRES_PROVISIONING_USER,
        // eslint-disable-next-line cspell/spellchecker
        '--dbname',
        'postgres',
        '--set',
        'ON_ERROR_STOP=1',
        '--command',
        `CREATE ROLE ${role} LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEROLE NOCREATEDB`,
        // separate commands, because CREATE DATABASE refuses to run inside a transaction block
        '--command',
        `CREATE DATABASE ${database} OWNER ${role}`,
        // behind a transaction pooler a connection carries what its role carries, which is the
        // operator's to set, the way the data source names it
        ...findTransactionPooler(dataSource) == undefined ? [] : dataSource.resolveRoleSettingsSql().flatMap(statement => ['--command', statement])
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`Could not provision the role of ${dataSource.constructor.name}:\n${result.output}`);
    }
}

/**
 * Starts PgBouncer in transaction mode in front of the postgres container of a data source, on the
 * network the two share.
 *
 * The distribution's own package rather than an image of somebody's: PgBouncer publishes none.
 * @param network - The network the postgres container is on, as {@link POSTGRES_NETWORK_ALIAS}.
 * @param dataSource - The data source whose credentials the pooler accepts and passes on.
 * @returns The running pooler.
 */
async function startPgBouncer(network: StartedNetwork, dataSource: PostgresDataSource): Promise<StartedTestContainer> {
    const { GenericContainer, Wait } = optionalPeer<typeof import('testcontainers')>('testcontainers', CONTAINERS_FEATURE);
    const username: string = dataSource.options.username ?? 'postgres';
    const password: string = dataSource.options.password?.toString() ?? 'password';
    const config: string = [
        '[databases]',
        `* = host=${POSTGRES_NETWORK_ALIAS} port=5432`,
        '[pgbouncer]',
        'listen_addr = 0.0.0.0',
        `listen_port = ${PGBOUNCER_PORT}`,
        'auth_type = scram-sha-256',
        `auth_file = ${PGBOUNCER_CONFIG_DIRECTORY}/userlist.txt`,
        'pool_mode = transaction',
        'max_client_conn = 500',
        'default_pool_size = 20'
    ].join('\n');
    return await new GenericContainer(PGBOUNCER_TEST_IMAGE)
        .withNetwork(network)
        .withCopyContentToContainer([
            { content: `${config}\n`, target: `${PGBOUNCER_CONFIG_DIRECTORY}/pgbouncer.ini`, mode: 0o644 },
            { content: `"${username}" "${password}"\n`, target: `${PGBOUNCER_CONFIG_DIRECTORY}/userlist.txt`, mode: 0o644 }
        ])
        // PgBouncer refuses to run as root, and switches to the user it is told to
        .withCommand([
            'sh',
            '-c',
            'apk add --no-cache pgbouncer && (id pgbouncer || adduser -D -H pgbouncer)'
            + ` && exec pgbouncer -u pgbouncer ${PGBOUNCER_CONFIG_DIRECTORY}/pgbouncer.ini`
        ])
        .withExposedPorts(PGBOUNCER_PORT)
        .withWaitStrategy(Wait.forLogMessage(/process up/))
        .withLabels(processLabels())
        .start();
}

/**
 * Runs statements as the superuser of a postgres container, in the database of the given data source.
 *
 * For what a test has to arrange that the application's own role may not do: another role, or a
 * grant across roles. Everything the application itself does stays with the role it connects as.
 * @param container - The started container of the data source.
 * @param dataSource - The data source whose database the statements run in.
 * @param statements - The statements, each run on its own, so that one refusing to run inside a
 * transaction block can be among them.
 * @throws When a statement is refused, naming what postgres said.
 */
export async function runAsSuperuser(container: StartedTestContainer, dataSource: PostgresDataSource, statements: string[]): Promise<void> {
    const result: ExecResult = await container.exec([
        'psql',
        '--username',
        POSTGRES_PROVISIONING_USER,
        // eslint-disable-next-line cspell/spellchecker
        '--dbname',
        dataSource.options.database ?? 'db',
        '--set',
        'ON_ERROR_STOP=1',
        ...statements.flatMap(statement => ['--command', statement])
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`Could not run as the superuser of ${dataSource.constructor.name}:\n${result.output}`);
    }
}

/**
 * Quotes a name for use as a sql identifier.
 * @param name - The name to quote.
 * @returns The quoted identifier.
 */
function quoteIdentifier(name: string): string {
    return `"${name.replaceAll('"', '""')}"`;
}

/**
 * Quotes a value for use as a sql string literal.
 * @param value - The value to quote.
 * @returns The quoted literal.
 */
function quoteLiteral(value: string): string {
    return `'${value.replaceAll('\'', '\'\'')}'`;
}

/**
 * Starts one container per given data source class that needs one, and points each data source at
 * its container.
 *
 * Shared by every harness that needs real storage, so a new supported data source kind has to be
 * taught here once instead of in each of them.
 * @param dataSourceClasses - The data source classes to start containers for.
 * @returns One started container per data source that needed one, in the order they were given.
 */
export async function startDataSourceContainers(
    dataSourceClasses: Newable<DataSourceInterface>[]
): Promise<StartedDataSourceContainer[]> {
    // settled rather than all: a start that fails leaves the others still starting, and once the
    // error is thrown nothing holds them to stop - they run until the process ends, and the docker
    // calls they still wait on land after the suite is gone
    await buildDataSources(dataSourceClasses);
    const settled: PromiseSettledResult<StartedDataSourceContainer | undefined>[] = await Promise.allSettled(
        dataSourceClasses.map(async dataSourceClass => {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            if (!needsContainer(dataSource)) {
                return undefined;
            }

            // loaded here rather than imported, because both are optional peers: a project testing
            // against an in-memory data source installs neither, and loads this module all the same
            if (dataSource instanceof ValKeyDataSource) {
                const { GenericContainer } = optionalPeer<typeof import('testcontainers')>('testcontainers', CONTAINERS_FEATURE);
                const valKeyContainer: StartedTestContainer = await new GenericContainer(VALKEY_TEST_IMAGE)
                    .withExposedPorts(VALKEY_PORT)
                    .withLabels(processLabels())
                    .start();
                const ports: DataSourcePorts = { port: valKeyContainer.getMappedPort(VALKEY_PORT), directPort: undefined };
                applyContainerPorts(dataSource, ports);
                return { dataSourceClass, container: valKeyContainer, ports, pooler: undefined };
            }

            const { PostgreSqlContainer } = optionalPeer<typeof import('@testcontainers/postgresql')>(
                '@testcontainers/postgresql',
                CONTAINERS_FEATURE
            );
            const { Network } = optionalPeer<typeof import('testcontainers')>('testcontainers', CONTAINERS_FEATURE);
            // a network only for a data source behind a pooler, which reaches the server by its name on it
            const network: StartedNetwork | undefined = findTransactionPooler(dataSource) == undefined
                ? undefined
                : await new Network().start();
            const starting: PostgreSqlContainer = new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
                .withDatabase('postgres')
                .withUsername(POSTGRES_PROVISIONING_USER)
                .withLabels(processLabels());
            const container: StartedPostgreSqlContainer = network == undefined
                ? await starting.start()
                : await starting.withNetwork(network).withNetworkAliases(POSTGRES_NETWORK_ALIAS).start();
            let pooler: StartedPooler | undefined;
            try {
                await provisionApplicationRole(container, dataSource);
                if (network != undefined) {
                    pooler = { container: await startPgBouncer(network, dataSource), network };
                }
            }
            catch (error) {
                await settleAfterFailure('stop a container', [container.stop(), ...network == undefined ? [] : [network.stop()]]);
                throw error;
            }
            const ports: DataSourcePorts = pooler == undefined
                ? { port: container.getMappedPort(5432), directPort: undefined }
                : { port: pooler.container.getMappedPort(PGBOUNCER_PORT), directPort: container.getMappedPort(5432) };
            applyContainerPorts(dataSource, ports);
            return { dataSourceClass, container, ports, pooler };
        })
    );

    const started: StartedDataSourceContainer[] = settled
        .flatMap(s => s.status === 'fulfilled' && s.value != undefined ? [s.value] : []);
    const failed: PromiseRejectedResult | undefined = settled.find(s => s.status === 'rejected');
    if (failed != undefined) {
        await settleAfterFailure('stop a container', started.map(s => stopDataSourceContainer(s)));
        throw failed.reason;
    }
    return started;
}

/**
 * The labels every container the harness starts carries.
 * @returns The labels.
 */
function processLabels(): Record<string, string> {
    return { [CONTAINER_PROCESS_LABEL]: String(process.pid) };
}