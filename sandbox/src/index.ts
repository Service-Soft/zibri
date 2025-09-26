import H from 'handlebars/runtime';
import { inject, isVersion, JwtAuthController, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication, ZibriInvoicingPlugin } from 'zibri';

import { CronController, FileController, MetricsController, TemplateController, TestController, TestCrudController, TestWebsocketController } from './controllers';
import { DbDataSource } from './data-sources';
import { version } from '../package.json';
import { createDefaultData } from './create-default-data.function';
import { StatusCronJob } from './cron';
import { providers } from './providers';

export let logger: LoggerInterface;

async function start(): Promise<void> {
    if (!isVersion(version)) {
        throw new Error('The version of the package.json is not valid.');
    }

    const app: ZibriApplication = new ZibriApplication({
        name: 'Api',
        baseUrl: 'http://localhost:3000',
        plugins: [ZibriInvoicingPlugin],
        controllers: [
            TestController,
            FileController,
            TemplateController,
            CronController,
            JwtAuthController,
            MetricsController,
            TestCrudController
        ],
        websocketControllers: [TestWebsocketController],
        dataSources: [DbDataSource],
        cronJobs: [StatusCronJob],
        version,
        providers
    });
    await app.init(H);

    logger = inject(ZIBRI_DI_TOKENS.LOGGER);

    await createDefaultData(DbDataSource);

    await app.start(3000);
}

void start();