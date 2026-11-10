{{#mailingList}}
import { OmitStrict, SemVerUtilities, ZIBRI_ENVIRONMENTS, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';
{{/mailingList}}
{{^mailingList}}
import { OmitStrict, SemVerUtilities, ZIBRI_ENVIRONMENTS, ZibriApplicationOptions } from 'zibri';
{{/mailingList}}

import { AppAuthController{{#mailingList}}, AppMailingListController{{/mailingList}}{{#docs}}, DocsController{{/docs}}, HealthController{{#pages}}, PageController{{/pages}} } from './controllers';
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
    name: '{{name}}',
    baseUrl: requireUrlEnv('BASE_URL'),
    plugins: [{{#mailingList}}new ZibriMailingListPlugin(){{/mailingList}}],
    controllers: [HealthController{{#pages}}, PageController{{/pages}}{{#docs}}, DocsController{{/docs}}{{#mailingList}}, AppMailingListController{{/mailingList}}, AppAuthController],
    websocketControllers: [],
    cronJobs: [],
    version,
    environment: requireOneOfEnv('ENVIRONMENT', ZIBRI_ENVIRONMENTS),
{{#publicByDefault}}
    // what an endpoint with no @Auth decorator requires. Switch to 'isLoggedIn' to have
    // a forgotten decorator answer 401 instead of serving anyone, and mark the endpoints
    // that really are public with @Auth.skip(). See the auth docs.
{{/publicByDefault}}
{{^publicByDefault}}
    // what an endpoint with no @Auth decorator requires: a forgotten decorator answers 401
    // instead of serving anyone. Mark the endpoints that really are public with @Auth.skip().
    // See the auth docs.
{{/publicByDefault}}
    defaultAuth: '{{defaultAuth}}',
    // whether a login asks for a second factor once the password was right: a user who enrolled
    // one presents it to log in. See the two factor docs.
    twoFactorAtLogin: 'ifEnrolled',
    providers
};
