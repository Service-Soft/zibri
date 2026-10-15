/**
 * What the routes of the authorization server allow.
 */
export type AuthorizationServerControllerOptions<RoleType extends string> = {
    /**
     * The roles that may ask whether a token is active, one of which the resource server's user holds.
     */
    introspectionRoles: RoleType[],
    /**
     * The services besides the application that a client may ask for a token for, by their urls
     * (RFC 8707), such as `https://reports.example.com`. Empty when tokens are for the application only.
     */
    resources: string[]
};