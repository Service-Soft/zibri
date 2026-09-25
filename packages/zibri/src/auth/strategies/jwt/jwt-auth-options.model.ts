/**
 * The options the jwt auth strategy runs with.
 *
 * The two secrets have no default and have to be provided - a framework that invented one would be
 * shipping every application the same signing key.
 */
export type JwtAuthOptions = {
    /**
     * The secret access tokens are signed with. Has to be provided.
     */
    readonly accessTokenSecret: string | undefined,
    /**
     * Secrets that access tokens are no longer signed with, but still verify against.
     *
     * A secret is replaced by moving the current one in here and providing a new one. Tokens issued
     * under the old secret keep working until they expire, so a rotation costs nobody their session.
     * Drop a secret from this list once it is older than
     * {@link JwtAuthOptions.accessTokenExpiresInMs} and every token it signed has expired anyway.
     */
    readonly previousAccessTokenSecrets: string[],
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
     * Same idea as {@link JwtAuthOptions.previousAccessTokenSecrets}, and it matters more here: a
     * refresh token is a live login, so replacing this secret without a window logs out everyone who
     * is not currently holding a valid access token.
     */
    readonly previousRefreshTokenSecrets: string[],
    /**
     * How long a refresh token is valid.
     */
    readonly refreshTokenExpiresInMs: number
};

/**
 * Input for modifying the jwt auth options.
 */
export type JwtAuthOptionsInput = Partial<JwtAuthOptions>;