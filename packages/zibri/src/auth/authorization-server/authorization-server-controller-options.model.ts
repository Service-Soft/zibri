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
    resources: string[],
    /**
     * How far ahead a jwt a client signs to authenticate itself may expire. A jwt is remembered as spent
     * until it expires. One hour by default.
     */
    maxClientAssertionLifetimeInMs?: number,
    /**
     * How far the clocks of a client and the application may be apart, for the times in a jwt the
     * client signs. A minute by default.
     */
    acceptedClockSkewInMs?: number,
    /**
     * How long a token issued to a client lasts. As long as the access tokens of logins by default,
     * `accessTokenExpiresInMs` of `ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT`.
     */
    accessTokenExpiresInMs?: number
};