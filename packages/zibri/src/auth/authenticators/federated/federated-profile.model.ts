/**
 * What a provider reports about who signed in, which the registration of a new user reads.
 */
export type FederatedProfile = {
    /**
     * The email the provider reports.
     */
    email: string | undefined,
    /**
     * Whether the provider has verified that email.
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
    familyName: string | undefined
};