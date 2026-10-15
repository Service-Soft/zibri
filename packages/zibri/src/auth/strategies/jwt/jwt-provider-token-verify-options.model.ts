/**
 * What a token an identity provider signed has to say.
 */
export type JwtProviderTokenVerifyOptions = {
    /**
     * Who must have issued it: the provider's issuer.
     */
    issuer: string,
    /**
     * Who it must be for, one of its `aud`.
     */
    audiences: string[],
    /**
     * The algorithms it may be signed with.
     */
    algorithms: string[]
};