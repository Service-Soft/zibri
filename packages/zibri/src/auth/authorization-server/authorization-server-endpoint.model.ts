/**
 * Where the routes of the authorization server answer, and what they allow.
 */
export type AuthorizationServerEndpoint = {
    /**
     * Who issues the tokens: the application's `baseUrl`.
     */
    issuer: string,
    /**
     * The url the routes are below: the `baseUrl`, followed by the path of the controller.
     */
    url: string,
    /**
     * The roles that may ask whether a token is active.
     */
    introspectionRoles: string[],
    /**
     * The services besides the application that a client may ask for a token for.
     */
    resources: string[]
};