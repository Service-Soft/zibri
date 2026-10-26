/**
 * What starts a login at a provider.
 */
export type FederatedLoginRequest = {
    /**
     * Where the login goes once it is done. Has to be under one of the allowed redirects.
     */
    redirectTo: string,
    /**
     * Whether the provider should have the user log in again rather than reuse its session.
     */
    reauthenticate: boolean,
    /**
     * The PKCE challenge of the frontend the login is handed to, which only the holder of its verifier
     * can take the login with. Undefined when the login logs in on the redirect back from the provider.
     */
    codeChallenge: string | undefined,
    /**
     * The name of the auth strategy that logs in on the redirect back from the provider, which the
     * result of the login names again. Undefined when the login is handed over by code, with the
     * `codeChallenge`.
     */
    strategy: string | undefined,
    /**
     * The scopes of the provider's apis to ask for on top of the authenticator's own, whose tokens are
     * kept for the identity. Each has to be one the authenticator allows.
     */
    apiScopes: string[]
};