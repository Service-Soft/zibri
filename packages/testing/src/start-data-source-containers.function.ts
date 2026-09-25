import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { AbstractStartedContainer, GenericContainer, StartedTestContainer } from 'testcontainers';
import { DataSourceInterface, inject, Newable, OmitStrict, PostgresDataSource, PostgresOptions, ValKeyDataSource, ValKeyOptions } from 'zibri';

/**
 * The postgres image every container backed test runs against.
 *
 * Pinned rather than `latest`, so a suite that passes today passes tomorrow for the same reason.
 */
export const POSTGRES_TEST_IMAGE: string = 'postgres:17.6';

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
    container: AbstractStartedContainer,
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
    if (dataSource instanceof ValKeyDataSource) {
        // eslint-disable-next-line typescript/no-unnecessary-type-assertion
        (dataSource.options as ValKeyOptions) = { ...dataSource.options, port };
        return;
    }
    (dataSource.options as OmitStrict<PostgresOptions, 'type'>) = { ...dataSource.options, port };
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
                return { dataSourceClass, container: valKeyContainer as unknown as AbstractStartedContainer, port };
            }

            const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
                .withDatabase(dataSource.options.database ?? 'db')
                .withUsername(dataSource.options.username ?? 'postgres')
                .withPassword(dataSource.options.password?.toString() ?? 'password')
                .start();
            const port: number = container.getMappedPort(5432);
            applyContainerPort(dataSource, port);
            return { dataSourceClass, container, port };
        })
    );
    return started.filter(c => c != undefined);
}