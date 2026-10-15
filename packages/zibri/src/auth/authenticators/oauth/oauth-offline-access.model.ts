/**
 * How a provider is asked for a refresh token, which lets its apis be called while the user is away.
 *
 * Added to every sign-in and connection that asks for scopes of the provider's apis.
 */
export type OAuthOfflineAccess = {
    /**
     * Scopes to ask for, eg. `offline_access`.
     */
    scopes: string[],
    /**
     * Values to add to the `prompt`, eg. `consent`.
     */
    prompts: string[],
    /**
     * Further parameters of the authorization request, eg. `access_type=offline`.
     */
    parameters: Record<string, string>
};