import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import H from 'handlebars/runtime';
import { AbstractStartedContainer } from 'testcontainers';

import { DefaultTestServerDataSource } from './database';
import { defaultTestServerPlugins } from './plugins';
import { defaultTestServerProviders } from './providers';
// eslint-disable-next-line eslintImport/no-unassigned-import
import './user-repository'; // this import is needed so that the DI system can pick up the user repository.
import { ZibriApplication } from '../../application';
import { ZibriApplicationOptions } from '../../application-options.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { DiContainer } from '../../di/di-container';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { noOp, POSTGRES_TEST_IMAGE } from '../constants';

type StartTestServerOptions = Partial<Pick<ZibriApplicationOptions, 'dataSources' | 'providers' | 'plugins'>>;

export class StartedTestServer {
    constructor(
        private readonly app: ZibriApplication,
        private readonly containers: AbstractStartedContainer[]
    ) {}

    async shutdown(): Promise<void> {
        await this.app.shutdown();
        await Promise.all(this.containers.map(c => c.stop()));
    }
}

export async function startTestServer(
    {
        dataSources = [DefaultTestServerDataSource],
        providers = defaultTestServerProviders,
        plugins = defaultTestServerPlugins
    }: StartTestServerOptions = {}
): Promise<StartedTestServer> {
    // Reset singleton — every test file gets a clean container with no stale instances.
    DiContainer['singleton'] = undefined;

    const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
        .withDatabase('db')
        .withUsername('postgres')
        .withPassword('password')
        .start();
    const ds: DefaultTestServerDataSource = inject(DefaultTestServerDataSource);
    ds.options = {
        ...ds.options,
        port: container.getMappedPort(5432)
    };
    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    await logger.info('starts up test server...');
    const info: typeof logger.info = logger.info;
    logger.info = noOp;

    const app: ZibriApplication = new ZibriApplication({
        name: 'test',
        version: '0.0.1',
        baseUrl: 'http://localhost:3000',
        controllers: [],
        websocketControllers: [],
        dataSources,
        providers,
        plugins
    });

    await app.init(H);

    logger.info = info;
    await logger.info('test server started');

    return new StartedTestServer(app, [container]);
}