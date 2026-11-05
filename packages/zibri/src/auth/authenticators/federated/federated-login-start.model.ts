/**
 * What a login at a provider is started with, for building the url the browser is sent to.
 */
export type FederatedLoginStart = {
    /**
     * What the provider hands back to find the login again.
     */
    state: string,
    /**
     * The secret of the cookie that ties the login to the browser. Never sent anywhere: what the
     * provider has to echo is derived from it, with `deriveFromBinding`.
     */
    binding: string,
    /**
     * Whether the provider should have the user log in again, even when it still has a session of theirs.
     */
    reauthenticate: boolean,
    /**
     * The scopes of the provider's apis the login asks for. Empty when it asks for none.
     */
    apiScopes: string[],
    /**
     * How long ago the user may have logged in at the provider for that login to count.
     */
    maxAuthenticationAgeInMs: number
};