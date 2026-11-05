/**
 * The origins whose pages may send a route a request with cookies: a list, or worked out per request from
 * the parameters of the route's path.
 */
export type AcceptedOrigins = string[] | ((pathParams: Record<string, string>) => string[] | Promise<string[]>);

/**
 * Options for `@AcceptCrossSitePosts`.
 */
export type AcceptCrossSitePostsOptions = {
    /**
     * The origins whose pages may send the route a request with cookies, eg. `['https://appleid.apple.com']`.
     * Compared with the `Origin` the browser sends.
     */
    acceptedOrigins: AcceptedOrigins
};