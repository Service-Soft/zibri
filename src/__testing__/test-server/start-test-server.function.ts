import { AddressInfo } from 'node:net';

import { jest } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import H from 'handlebars/runtime';
import { AbstractStartedContainer } from 'testcontainers';

import { defaultTestServerPlugins } from './plugins';
import { defaultTestServerProviders } from './providers';
// eslint-disable-next-line eslintImport/no-unassigned-import
import './user-repository'; // this import is needed so that the DI system can pick up the user repository.
import { ZibriApplication } from '../../application';
import { ZibriApplicationOptions } from '../../application-options.model';
import { PostgresDataSource, PostgresOptions } from '../../data-source/data-sources/postgres-typeorm-data-source.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { DiContainer } from '../../di/di-container';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { noOp, POSTGRES_TEST_IMAGE, testAssetsFolder } from '../constants';
import { createTestDataSource } from './create-test-data-source.function';
import { AssetServiceInterface } from '../../assets/asset-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';

type StartTestServerOptions = Partial<Pick<ZibriApplicationOptions, 'providers' | 'plugins' | 'controllers' | 'cronJobs'>> & {
    dataSources?: Newable<PostgresDataSource>[]
};

export class StartedTestServer {
    constructor(
        private readonly app: ZibriApplication,
        private readonly containers: AbstractStartedContainer[],
        private readonly exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    ) {}

    async start(): Promise<string> {
        await this.app.start(0);
        const address: string | AddressInfo | null = this.app.server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('Failed to resolve test server port.');
        }
        const host: string = address.address === '::' || address.address === '0.0.0.0'
            ? '127.0.0.1'
            : address.address;
        return `http://${host}:${address.port}`;
    }

    async shutdown(): Promise<void> {
        await this.app.shutdown();
        this.exitSpy.mockRestore();
        await Promise.all(this.containers.map(c => c.stop()));
    }
}

export async function startTestServer(
    {
        dataSources = [createTestDataSource()],
        providers = defaultTestServerProviders,
        plugins = defaultTestServerPlugins,
        controllers = [],
        cronJobs = []
    }: StartTestServerOptions = {}
): Promise<StartedTestServer> {
    // Reset singleton — every test file gets a clean container with no stale instances.
    DiContainer['singleton'] = undefined;

    const containers: StartedPostgreSqlContainer[] = await Promise.all(dataSources.map(async ds => {
        const dataSource: PostgresDataSource = inject(ds);
        const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase(dataSource.options.database ?? 'db')
            .withUsername(dataSource.options.username ?? 'postgres')
            .withPassword(dataSource.options.password?.toString() ?? 'password')
            .start();
        (dataSource.options as OmitStrict<PostgresOptions, 'type' | 'entities'>) = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        return container;
    }));

    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    await logger.info('starts up test server...');
    const info: typeof logger.info = logger.info;
    logger.info = noOp;

    const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);
    (assetService.assetsPath as string) = testAssetsFolder;

    const app: ZibriApplication = new ZibriApplication({
        name: 'test',
        version: '0.0.1',
        baseUrl: 'http://localhost:3000',
        controllers,
        websocketControllers: [],
        dataSources,
        providers,
        plugins,
        cronJobs
    });

    await app.init(H);

    logger.info = info;
    await logger.info('test server started');

    return new StartedTestServer(app, containers);
}