/**
 * Who logged in at a provider, for creating the user they become.
 */
export type FederatedRegistration = {
    /**
     * The name of the authenticator the login went through.
     */
    provider: string,
    /**
     * The issuer the provider's identities are known by: the `iss` of an OpenID Connect provider's ID
     * tokens, the entity id of a SAML identity provider, or the one its authenticator names.
     */
    issuer: string,
    /**
     * Who logged in at the provider, as the provider names them.
     */
    subject: string,
    /**
     * The email the provider reports.
     */
    email: string | undefined,
    /**
     * Whether the provider has verified that email. Only a verified email belongs to whoever logged in.
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
     * Everything the provider proved about them: the claims of an OpenID Connect ID token, the
     * attributes of a SAML assertion, or what a provider that speaks plain OAuth2 answers about them.
     */
    claims: Record<string, unknown>,
    /**
     * Where the login was to go once it was done, one of the allowed redirects.
     */
    redirectTo: string
};