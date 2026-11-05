import { setTimeout as sleep } from 'node:timers/promises';

import type { ExecResult, GenericContainer, StartedNetwork, StartedTestContainer } from 'testcontainers';
import { DataSourceInterface, inject, Newable, optionalPeer, PostgresDataSource, PostgresOptions, PostgresPooler, PostgresTransactionPooler, ValKeyDataSource, ValKeyOptions } from 'zibri';
import { DiContainer } from 'zibri/internal';

import { settleAfterFailure } from './settle-after-failure.function';

// pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason
/**
 * The postgres image every container backed test runs against.
 */
export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';

/**
 * The superuser a postgres container is created with. Only the harness connects as it, to create the
 * role the data source connects as.
 */
const POSTGRES_PROVISIONING_USER: string = 'zibri_testing_provisioner';

/**
 * The port postgres listens on inside its container.
 */
const POSTGRES_PORT: number = 5432;

/**
 * What postgres logs once it accepts connections.
 */
const POSTGRES_READY_LOG: RegExp = /database system is ready to accept connections/;

/**
 * The valkey image every container backed test runs against.
 */
export const VALKEY_TEST_IMAGE: string = 'valkey/valkey:8-alpine';

/**
 * The port valkey listens on inside its container.
 */
export const VALKEY_PORT: number = 6379;

/**
 * What valkey logs once it accepts connections.
 */
const VALKEY_READY_LOG: RegExp = /Ready to accept connections/;

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
 * How long the connections of an application may take to be gone from the server once it shut down.
 */
const CONNECTIONS_CLOSE_WITHIN_MS: number = 5000;

/**
 * How long to wait before asking the server again whether they are.
 */
const CONNECTIONS_CLOSED_POLL_INTERVAL_IN_MS: number = 100;

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
 * Who a postgres test container is set up for.
 */
export type PostgresTestContainerOptions = {
    /**
     * The superuser the container is created with.
     */
    username: string,
    /**
     * The superuser's password.
     */
    password: string,
    /**
     * The database the container is created with.
     */
    database: string
};

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
    // eslint-disable-next-line typescript/no-unnecessary-type-assertion
    (dataSource.options as PostgresOptions) = { ...dataSource.options, port };
    // the server itself is a second address, known as late as the first
    const pooler: PostgresTransactionPooler | undefined = findTransactionPooler(dataSource);
    if (pooler != undefined && ports.directPort != undefined) {
        // eslint-disable-next-line typescript/no-unnecessary-type-assertion
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
async function provisionApplicationRole(container: StartedTestContainer, dataSource: PostgresDataSource): Promise<void> {
    // an application running as the superuser is an application nobody deploys, and a suite running
    // as one cannot see anything that needs a privilege the application would not have - a boot that
    // installs an extension, a backup that reads the cluster. Written out rather than left to the
    // defaults of CREATE ROLE, so the statement is the contract
    const role: string = quoteIdentifier(dataSource.options.username ?? 'postgres');
    const password: string = quoteLiteral(dataSource.options.password?.toString() ?? 'password');
    const database: string = quoteIdentifier(dataSource.options.database ?? 'db');
    const result: ExecResult = await container.exec([
        ...getSuperuserPsql('postgres'),
        '--command',
        `CREATE ROLE ${role} LOGIN PASSWORD ${password} NOSUPERUSER NOCREATEROLE NOCREATEDB`,
        // separate commands, because CREATE DATABASE refuses to run inside a transaction block
        '--command',
        `CREATE DATABASE ${database} OWNER ${role}`,
        // behind a transaction pooler a connection carries what its role carries, which is the
        // operator's to set, the way the data source names it
        ...findTransactionPooler(dataSource) == undefined
            ? []
            : dataSource.resolveRoleSettingsSql().flatMap(statement => ['--command', statement])
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
        ...getSuperuserPsql(dataSource.options.database ?? 'db'),
        ...statements.flatMap(statement => ['--command', statement])
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`Could not run as the superuser of ${dataSource.constructor.name}:\n${result.output}`);
    }
}

/**
 * Fails when a connection of a postgres data source is still open after its application shut down.
 *
 * Waits a moment first: a connection closed on shutdown is gone from the server shortly after.
 * @param started - What was started for the data source.
 * @param dataSource - The data source, whose role its connections log in as.
 * @throws When a connection is still open, naming what each one ran last.
 */
export async function validateConnectionsClosed(started: StartedDataSourceContainer, dataSource: PostgresDataSource): Promise<void> {
    const deadline: number = Date.now() + CONNECTIONS_CLOSE_WITHIN_MS;
    let open: string[] = await findOpenConnections(started, dataSource);
    while (open.length && Date.now() < deadline) {
        await sleep(CONNECTIONS_CLOSED_POLL_INTERVAL_IN_MS);
        open = await findOpenConnections(started, dataSource);
    }
    if (!open.length) {
        return;
    }
    throw new Error([
        `${open.length} connection(s) of ${dataSource.constructor.name} outlived the application:`,
        ...open.map(connection => `  - ${connection}`)
    ].join('\n'));
}

/**
 * Finds the connections of a postgres data source that are still open: to its server, as its role,
 * and to the pooler in front of it.
 * @param started - What was started for the data source.
 * @param dataSource - The data source.
 * @returns One line per open connection.
 * @throws When the server or the pooler cannot be asked.
 */
async function findOpenConnections(started: StartedDataSourceContainer, dataSource: PostgresDataSource): Promise<string[]> {
    // the pooler's own connections to the server stay open for the next client by design, so only
    // the ones from anywhere else count there, and the pooler is asked about its clients itself
    const poolerAddress: string | undefined = started.pooler?.container.getIpAddress(started.pooler.network.getName());
    const result: ExecResult = await started.container.exec([
        ...getSuperuserPsql('postgres'),
        '--no-align',
        '--tuples-only',
        '--command',
        'SELECT format(\'pid %s, %s, last ran: %s\', pid, state, regexp_replace(left(query, 200), \'\\s+\', \' \', \'g\'))'
        + ' FROM pg_stat_activity'
        + ` WHERE usename = ${quoteLiteral(dataSource.options.username ?? 'postgres')}`
        + (poolerAddress == undefined ? '' : ` AND client_addr IS DISTINCT FROM ${quoteLiteral(poolerAddress)}::inet`)
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`Could not ask the server of ${dataSource.constructor.name} for its connections:\n${result.output}`);
    }
    const open: string[] = result.stdout.split('\n').filter(line => line.trim().length);
    if (started.pooler == undefined) {
        return open;
    }
    // busybox's netstat, which the pooler's alpine image comes with
    const clients: ExecResult = await started.pooler.container.exec([
        'sh',
        '-c',
        `netstat -tn | awk '$4 ~ /:${PGBOUNCER_PORT}$/ && $6 == "ESTABLISHED"'`
    ]);
    if (clients.exitCode !== 0) {
        throw new Error(`Could not ask the pooler of ${dataSource.constructor.name} for its clients:\n${clients.output}`);
    }
    return [
        ...open,
        ...clients.stdout.split('\n')
            .filter(line => line.trim().length)
            .map(line => `to the pooler: ${line.trim()}`)
    ];
}

/**
 * Gets the start of a psql command run inside a postgres container as its superuser, which stops
 * at the first statement that fails.
 * @param database - The database to connect to.
 * @returns The command and its arguments, which the statements to run follow.
 */
function getSuperuserPsql(database: string): string[] {
    return [
        'psql',
        '--username',
        POSTGRES_PROVISIONING_USER,
        // eslint-disable-next-line cspell/spellchecker
        '--dbname',
        database,
        '--set',
        'ON_ERROR_STOP=1'
    ];
}

/**
 * Creates a postgres container for a test, which counts as started once postgres accepts connections.
 *
 * Postgres says so in its log, so nothing is run inside the container to find out, and it carries no
 * health check either.
 * @param options - The superuser and the database the container is created with.
 * @param options.username - The superuser the container is created with.
 * @param options.password - The superuser's password.
 * @param options.database - The database the container is created with.
 * @returns The container, not started yet.
 */
export function createPostgresTestContainer({ username, password, database }: PostgresTestContainerOptions): GenericContainer {
    // a plain container rather than the postgres module's: that one asks the container runtime whether
    // it is ready by running commands inside it, three every tenth of a second until the port is
    // bound, which is only after the database is initialized, and adds a health check the runtime
    // runs inside it every quarter of a second for as long as it runs. Each container starting beside
    // it made the others slower, and a boot of a few seconds took over forty in a full run
    const { GenericContainer: Container, Wait } = optionalPeer<typeof import('testcontainers')>('testcontainers', CONTAINERS_FEATURE);
    return new Container(POSTGRES_TEST_IMAGE)
        .withEnvironment({ POSTGRES_USER: username, POSTGRES_PASSWORD: password, POSTGRES_DB: database })
        .withExposedPorts(POSTGRES_PORT)
        // twice: once by the server that initializes the database, which accepts no connections over
        // the network, and once by the one that serves it
        .withWaitStrategy(Wait.forLogMessage(POSTGRES_READY_LOG, 2))
        .withLabels(processLabels());
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

            // loaded here rather than imported, because it is an optional peer: a project testing
            // against an in-memory data source does not install it, and loads this module all the same
            const { GenericContainer, Network, Wait } = optionalPeer<typeof import('testcontainers')>('testcontainers', CONTAINERS_FEATURE);
            if (dataSource instanceof ValKeyDataSource) {
                const valKeyContainer: StartedTestContainer = await new GenericContainer(VALKEY_TEST_IMAGE)
                    .withExposedPorts(VALKEY_PORT)
                    // from its log rather than by running commands inside it, for the reason
                    // createPostgresTestContainer gives
                    .withWaitStrategy(Wait.forLogMessage(VALKEY_READY_LOG))
                    .withLabels(processLabels())
                    .start();
                const ports: DataSourcePorts = { port: valKeyContainer.getMappedPort(VALKEY_PORT), directPort: undefined };
                applyContainerPorts(dataSource, ports);
                return { dataSourceClass, container: valKeyContainer, ports, pooler: undefined };
            }

            // a network only for a data source behind a pooler, which reaches the server by its name on it
            const network: StartedNetwork | undefined = findTransactionPooler(dataSource) == undefined
                ? undefined
                : await new Network().start();
            // the superuser's password is never used: only the harness connects as it, from inside
            // the container, where the image trusts local connections
            const starting: GenericContainer = createPostgresTestContainer({
                username: POSTGRES_PROVISIONING_USER,
                password: 'password',
                database: 'postgres'
            });
            const container: StartedTestContainer = network == undefined
                ? await starting.start()
                : await starting.withNetwork(network).withNetworkAliases(POSTGRES_NETWORK_ALIAS)
                    .start();
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
                ? { port: container.getMappedPort(POSTGRES_PORT), directPort: undefined }
                : { port: pooler.container.getMappedPort(PGBOUNCER_PORT), directPort: container.getMappedPort(POSTGRES_PORT) };
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