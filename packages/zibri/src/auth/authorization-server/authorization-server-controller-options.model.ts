import { type PlatformPermission } from '../roles/platform-permission.type';

/**
 * What the routes of the authorization server allow.
 */
export type AuthorizationServerControllerOptions = {
    /**
     * The platform permission to ask whether a token is active with, which one of the resource
     * server's user's own roles carries and, for a resource server sending an api key, the key lists.
     */
    introspectionPermission: PlatformPermission,
    /**
     * The services besides the application that a client may ask for a token for, by their urls
     * (RFC 8707), such as `https://reports.example.com`. Empty when tokens are for the application only.
     */
    resources: string[]
};