/**
 * What a jwt has to say besides being signed with one of the keys it is checked against.
 */
export type JwtVerifyOptions = {
    /**
     * Who the token must say issued it.
     */
    issuer: string,
    /**
     * Who the token must be for, one of its `aud`. Undefined accepts a token for anyone.
     */
    audience: string | undefined,
    /**
     * The `typ` its header must name.
     */
    type: 'at+jwt' | 'JWT' | 'dpop-nonce+jwt'
};