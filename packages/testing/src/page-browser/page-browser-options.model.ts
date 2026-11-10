/**
 * Where the application is reached, and where its server listens, when the two differ.
 */
export type PageBrowserProxy = {
    /**
     * The application's `baseUrl`, which the pages are opened under.
     */
    baseUrl: string,
    /**
     * Where the server listens, as `StartedTestServer.start` answers it.
     */
    appUrl: string
};

/**
 * What a page browser is started with.
 */
export type PageBrowserOptions = {
    /**
     * The packages the pages import with `?client`, such as `chart.js`. Their scripts are served from the
     * application's `node_modules`, the way the build writes them, so a test needs no build first.
     */
    vendorPackages?: string[],
    /**
     * Plays the reverse proxy of a deployment: a page opened under the base url, and everything a page
     * loads from it, is answered by the server, while the page keeps the base url as its origin. Links the
     * application builds from its base url, such as the api url a page sends a form to, then reach the
     * server.
     */
    behindProxy?: PageBrowserProxy
};