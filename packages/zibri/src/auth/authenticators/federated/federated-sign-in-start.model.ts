/**
 * What a sign-in at a provider is started with, for building the url the browser is sent to.
 */
export type FederatedSignInStart = {
    /**
     * What the provider hands back to find the sign-in again.
     */
    state: string,
    /**
     * The secret of the cookie that ties the sign-in to the browser. Never sent anywhere: what the
     * provider has to echo is derived from it, with `deriveFromBinding`.
     */
    binding: string,
    /**
     * Whether the provider should have the user sign in again rather than reuse its session.
     */
    reauthenticate: boolean,
    /**
     * The scopes of the provider's apis the sign-in asks for. Empty when it asks for none.
     */
    apiScopes: string[],
    /**
     * How long ago the user may have signed in at the provider for that sign-in to count.
     */
    maxAuthenticationAgeInMs: number
};