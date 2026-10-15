/**
 * An access token that was just issued to a client.
 */
export type IssuedClientAccessToken = {
    /**
     * The token.
     */
    value: string,
    /**
     * How long it is valid, in milliseconds.
     */
    expiresInMs: number
};