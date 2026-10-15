/**
 * The session a provider's answer to a sign-in says the user has there.
 */
export type FederatedProviderSession = {
    /**
     * The provider's id of the session, such as the `SessionIndex` of SAML. Undefined when it names none.
     */
    id: string | undefined,
    /**
     * What the authenticator needs to end the session at the provider, in its own words.
     */
    logout: string
};