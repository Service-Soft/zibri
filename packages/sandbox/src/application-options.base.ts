import { JwtAuthController, MailingListController, OmitStrict, SemVerUtilities, ZibriApplicationOptions, ZibriInvoicingPlugin, ZibriMailingListPlugin } from 'zibri';

import { CronController, FileController, HealthController, MetricsController, PageController, TemplateController, TestController, TestCrudController, TestWebsocketController } from './controllers';
import { StatusCronJob } from './cron';
import { requireEnv } from './env';
import { version } from '../package.json';
import { providers } from './providers';

if (!SemVerUtilities.isSemVerVersion(version)) {
    throw new Error('The version of the package.json is not valid.');
}

/**
 * Everything this application is, apart from where it keeps its data.
 *
 * Split from the data source so that a test can build the same application on a different one:
 * importing a module registers whatever it declares, and a data source that is registered without
 * being deployed is refused at boot. A test therefore has to reach the controllers, plugins and
 * providers without reaching the production data source.
 */
export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Zibri Api',
    baseUrl: requireEnv('BASE_URL'),
    plugins: [new ZibriInvoicingPlugin(), new ZibriMailingListPlugin()],
    controllers: [
        HealthController,
        TestController,
        FileController,
        TemplateController,
        CronController,
        JwtAuthController,
        MetricsController,
        TestCrudController,
        PageController,
        MailingListController
    ],
    websocketControllers: [TestWebsocketController],
    cronJobs: [StatusCronJob],
    version,
    // what an endpoint with no @Auth decorator requires. Switch to 'requireLogin' to have
    // a forgotten decorator answer 401 instead of serving anyone, and mark the endpoints
    // that really are public with @Auth.skip(). See the auth docs.
    defaultAuth: 'public',
    providers
};