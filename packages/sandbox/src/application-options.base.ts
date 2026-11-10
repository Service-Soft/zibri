import { OmitStrict, SemVerUtilities, ZIBRI_ENVIRONMENTS, ZibriApplicationOptions, ZibriInvoicingPlugin, ZibriMailingListPlugin } from 'zibri';

import { AppAuthController, AppMailingListController, CronController, DocsController, FileController, HealthController, MetricsController, PageController, TemplateController, TestController, TestCrudController, TestWebsocketController } from './controllers';
import { StatusCronJob } from './cron';
import { requireOneOfEnv, requireUrlEnv } from './env';
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
    baseUrl: requireUrlEnv('BASE_URL'),
    plugins: [new ZibriInvoicingPlugin(), new ZibriMailingListPlugin()],
    controllers: [
        HealthController,
        TestController,
        FileController,
        TemplateController,
        CronController,
        AppAuthController,
        MetricsController,
        TestCrudController,
        PageController,
        DocsController,
        AppMailingListController
    ],
    websocketControllers: [TestWebsocketController],
    cronJobs: [StatusCronJob],
    version,
    environment: requireOneOfEnv('ENVIRONMENT', ZIBRI_ENVIRONMENTS),
    // what an endpoint with no @Auth decorator requires. Switch to 'isLoggedIn' to have
    // a forgotten decorator answer 401 instead of serving anyone, and mark the endpoints
    // that really are public with @Auth.skip(). See the auth docs.
    defaultAuth: 'public',
    // whether a login asks for a second factor once the password was right: a user who enrolled
    // one presents it to log in. See the two factor docs.
    twoFactorAtLogin: 'ifEnrolled',
    providers
};