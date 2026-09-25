/* eslint-disable jsdoc/check-param-names */
import { StartedTestServer, StartTestServerOptions, startTestServer as startHarness } from 'zibri-testing';

import { createTestDataSource } from './create-test-data-source.function';
import { defaultTestServerPlugins } from './plugins';
import { defaultTestServerProviders } from './providers';
// eslint-disable-next-line eslintImport/no-unassigned-import
import './user-repository'; // this import is needed so that the DI system can pick up the user repository.
import { testAssetsFolder } from '../constants';

export { StartedTestServer } from 'zibri-testing';

// eslint-disable-next-line jsdoc/require-param
/**
 * Starts a test server carrying this repository's own fixtures.
 *
 * The harness itself is `zibri-testing`, which ships - what this adds is the furniture that belongs
 * to the framework's suite rather than to any application: the JwtUser entity and its repository,
 * a container backed postgres data source, and the assets folder the asset tests read from. A
 * consumer gets the harness without any of it.
 * @param options - What the application is built from. Anything left out is this repository's default.
 * @returns The started server, which the test is responsible for shutting down.
 */
export async function startTestServer({
    dataSources = [createTestDataSource()],
    providers = defaultTestServerProviders,
    plugins = defaultTestServerPlugins,
    assetsPath = testAssetsFolder,
    ...rest
}: StartTestServerOptions = {}): Promise<StartedTestServer> {
    return await startHarness({ dataSources, providers, plugins, assetsPath, ...rest });
}