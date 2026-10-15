import { JwtAsymmetricKey } from './jwt-asymmetric-key.model';

/**
 * The options the jwt auth strategy runs with.
 *
 * The access token key and the refresh token secret have no default and have to be provided - a
 * framework that invented one would be shipping every application the same signing key.
 */
export type JwtAuthOptions = {
    /**
     * What access tokens are signed with. Has to be provided.
     *
     * A string is a shared secret, and every service that verifies your access tokens has to hold
     * it. A key pair signs with its private key, and a verifier needs only the public key.
     */
    readonly accessTokenKey: string | JwtAsymmetricKey | undefined,
    /**
     * Keys that access tokens are no longer signed with, but still verify against.
     *
     * A key is replaced by moving the current one in here and providing a new one. Tokens issued
     * under the old key keep working until they expire, so a rotation costs nobody their session.
     * Drop a key from this list once it is older than {@link JwtAuthOptions.accessTokenExpiresInMs}
     * and every token it signed has expired anyway.
     */
    readonly previousAccessTokenKeys: (string | JwtAsymmetricKey)[],
    /**
     * How long an access token is valid.
     */
    readonly accessTokenExpiresInMs: number,
    /**
     * The secret refresh tokens are signed with. Has to be provided, and has to differ from every
     * access token secret.
     */
    readonly refreshTokenSecret: string | undefined,
    /**
     * Secrets that refresh tokens are no longer signed with, but still verify against.
     *
     * Same idea as {@link JwtAuthOptions.previousAccessTokenKeys}, and it matters more here: a
     * refresh token is a live login, so replacing this secret without a window logs out everyone who
     * is not currently holding a valid access token.
     */
    readonly previousRefreshTokenSecrets: string[],
    /**
     * How long a refresh token is valid.
     */
    readonly refreshTokenExpiresInMs: number,
    /**
     * Whether a login is bound to a DPoP key: true refuses a login, a refresh and an access token
     * without a DPoP proof, false binds those that send one. Defaults to false.
     */
    readonly requireDpop: boolean
};

/**
 * Input for modifying the jwt auth options.
 */
export type JwtAuthOptionsInput = Partial<JwtAuthOptions>;