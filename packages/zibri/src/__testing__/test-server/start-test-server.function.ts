/* eslint-disable jsdoc-js/check-param-names */
import { StartedTestServer, StartTestServerOptions, startTestServer as startHarness } from 'zibri-testing';

import { createTestDataSource } from './create-test-data-source.function.ts';
// eslint-disable-next-line import/no-unassigned-import
import './membership-repository.ts'; // and this one for the membership repository the users act in their tenants through.
import { defaultTestServerPlugins } from './plugins.ts';
import { defaultTestServerProviders } from './providers.ts';
// eslint-disable-next-line import/no-unassigned-import
import './user-repository.ts'; // this import is needed so that the DI system can pick up the user repository.

export { StartedTestServer } from 'zibri-testing';

/**
 * Starts a test server carrying this repository's own fixtures.
 *
 * The harness itself is `zibri-testing`, which ships - what this adds is the furniture that belongs
 * to the framework's suite rather than to any application: the JwtUser entity and its repository
 * and a container backed postgres data source. A consumer gets the harness without any of it.
 * @param options - What the application is built from. Anything left out is this repository's default.
 * @returns The started server, which the test is responsible for shutting down.
 */
export async function startTestServer({
    // oxlint-disable-next-line jsdoc/require-param
    dataSources = [createTestDataSource()],
    providers = defaultTestServerProviders,
    plugins = defaultTestServerPlugins,
    ...rest
}: StartTestServerOptions = {}): Promise<StartedTestServer> {
    return await startHarness({ dataSources, providers, plugins, ...rest });
}