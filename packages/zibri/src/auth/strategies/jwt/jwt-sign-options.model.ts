/**
 * What a jwt is signed with besides its payload and its key.
 */
export type JwtSignOptions = {
    /**
     * How long the token is valid, in milliseconds.
     */
    expiresInMs: number,
    /**
     * Who the token says issued it.
     */
    issuer: string,
    /**
     * Who the token is for, written as its `aud`. Left out of the token when undefined.
     */
    audience: string | string[] | undefined,
    /**
     * The `typ` of its header: `at+jwt` for an access token (RFC 9068), `dpop-nonce+jwt` for a nonce a
     * DPoP proof carries, `JWT` for anything else.
     */
    type: 'at+jwt' | 'JWT' | 'dpop-nonce+jwt',
    /**
     * A unique id for the token, written as its `jti`.
     */
    jwtId?: string
};