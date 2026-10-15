/**
 * The tokens a provider issued for calling its apis, as a sign-in that asked for them hands them on.
 */
export type ProviderTokenGrant = {
    /**
     * The access token.
     */
    accessToken: string,
    /**
     * The refresh token issued with it, if any.
     */
    refreshToken: string | undefined | null,
    /**
     * When the access token stops being accepted, if the provider said.
     */
    accessTokenExpirationDate: Date | undefined | null,
    /**
     * The scopes the provider granted them.
     */
    grantedScopes: string[]
};