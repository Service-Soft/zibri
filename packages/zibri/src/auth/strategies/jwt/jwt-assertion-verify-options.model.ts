/**
 * What a jwt a client signed to authenticate itself has to say (RFC 7523).
 */
export type JwtAssertionVerifyOptions = {
    /**
     * Who must have issued it and be its subject: the client.
     */
    clientId: string,
    /**
     * Who it must be for, one of its `aud`: the token endpoint, or the issuer of the authorization server.
     */
    audiences: string[]
};