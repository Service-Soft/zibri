/**
 * Why there is no access token for calling a provider's apis for a user.
 */
export enum ProviderAccessFailure {
    /**
     * No tokens are kept for the identity: it was linked to sign in only, or its tokens were removed.
     */
    NOT_CONNECTED = 'not_connected',
    /**
     * The provider did not grant the kept tokens every scope asked for.
     */
    MISSING_SCOPES = 'missing_scopes',
    /**
     * The access token expired, and the provider issued no refresh token to ask for a new one with.
     */
    EXPIRED = 'expired',
    /**
     * The provider refused the refresh token, because the user withdrew the access there or it lapsed.
     * The tokens are removed.
     */
    REVOKED = 'revoked'
}