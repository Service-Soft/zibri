import { ZibriApplicationOptions } from 'zibri';

/**
 * Everything that can be configured about a test server.
 *
 * Also describes what a cluster instance boots with, so anything a single process test can be built
 * from can be run across several processes without a second option type.
 */
export type StartTestServerOptions = Partial<ZibriApplicationOptions> & {
    /**
     * The application the test is about, as the options it is built from.
     *
     * This is what makes a test a test *of an application* rather than of a server assembled to
     * resemble one: the controllers, entities, plugins and providers are the ones that ship, and
     * anything named beside this replaces that one key.
     *
     * An application exports these so its entry point and its tests build from the same thing.
     * What neither this nor the call names is the harness's own default, which is what a test with
     * no application to point at runs on.
     */
    application?: ZibriApplicationOptions,
    /**
     * Where the application serves its static assets from.
     *
     * Left out by anything that does not serve assets, which is most tests.
     */
    assetsPath?: string
};