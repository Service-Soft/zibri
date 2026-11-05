import { type PlatformPermission } from '../roles/platform-permission.type';

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
     * The permission to ask whether a token is active with.
     */
    introspectionPermission: PlatformPermission,
    /**
     * The services besides the application that a client may ask for a token for.
     */
    resources: string[],
    /**
     * How far ahead a jwt a client signs to authenticate itself may expire.
     */
    maxClientAssertionLifetimeInMs: number,
    /**
     * How far the clocks of a client and the application may be apart, for the times in a jwt the
     * client signs.
     */
    acceptedClockSkewInMs: number,
    /**
     * How long a token issued to a client lasts, or undefined for as long as the issuing strategy's
     * own access tokens.
     */
    accessTokenExpiresInMs: number | undefined
};