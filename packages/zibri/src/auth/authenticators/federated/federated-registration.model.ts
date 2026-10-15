/**
 * Who signed in at a provider, for creating the user they become.
 */
export type FederatedRegistration = {
    /**
     * The name of the authenticator the sign-in went through.
     */
    provider: string,
    /**
     * The issuer the provider's identities are known by: the `iss` of an OpenID Connect provider's ID
     * tokens, the entity id of a SAML identity provider, or the one its authenticator names.
     */
    issuer: string,
    /**
     * Who signed in at the provider, as the provider names them.
     */
    subject: string,
    /**
     * The email the provider reports.
     */
    email: string | undefined,
    /**
     * Whether the provider has verified that email. Only a verified email belongs to whoever signed in.
     */
    emailVerified: boolean | undefined,
    /**
     * The full name the provider reports.
     */
    name: string | undefined,
    /**
     * The given name the provider reports.
     */
    givenName: string | undefined,
    /**
     * The family name the provider reports.
     */
    familyName: string | undefined,
    /**
     * Where the sign-in was to go once it was done, one of the allowed redirects.
     */
    redirectTo: string
};