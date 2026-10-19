import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ExecResult, GenericContainer, StartedTestContainer } from 'testcontainers';
import { DataSourceInterface, inject, Newable, OmitStrict, PostgresDataSource, PostgresOptions, ValKeyDataSource, ValKeyOptions } from 'zibri';

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
 * Any data source a test harness knows how to start a container for.
 */
export type TestDataSource = PostgresDataSource | ValKeyDataSource;

/**
 * A container that was started for one data source class.
 */
export type StartedDataSourceContainer = {
    /**
     * The data source class the container was started for.
     */
    dataSourceClass: Newable<DataSourceInterface>,
    /**
     * The running container.
     */
    container: StartedTestContainer,
    /**
     * The host port that the container's data source port got mapped to.
     */
    port: number
};

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
 * Applies the port that the container of the given data source got mapped to.
 * @param dataSource - The data source to apply the port to.
 * @param port - The mapped port of its container.
 */
export function applyContainerPort(dataSource: TestDataSource, port: number): void {
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
        `CREATE DATABASE ${database} OWNER ${role}`
    ]);
    if (result.exitCode !== 0) {
        throw new Error(`Could not provision the role of ${dataSource.constructor.name}:\n${result.output}`);
    }
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
    const started: (StartedDataSourceContainer | undefined)[] = await Promise.all(
        dataSourceClasses.map(async dataSourceClass => {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            if (!needsContainer(dataSource)) {
                return undefined;
            }

            if (dataSource instanceof ValKeyDataSource) {
                const valKeyContainer: StartedTestContainer = await new GenericContainer(VALKEY_TEST_IMAGE)
                    .withExposedPorts(VALKEY_PORT)
                    .start();
                const port: number = valKeyContainer.getMappedPort(VALKEY_PORT);
                applyContainerPort(dataSource, port);
                return { dataSourceClass, container: valKeyContainer, port };
            }

            const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
                .withDatabase('postgres')
                .withUsername(POSTGRES_PROVISIONING_USER)
                .start();
            await provisionApplicationRole(container, dataSource);
            const port: number = container.getMappedPort(5432);
            applyContainerPort(dataSource, port);
            return { dataSourceClass, container, port };
        })
    );
    return started.filter(c => c != undefined);
}