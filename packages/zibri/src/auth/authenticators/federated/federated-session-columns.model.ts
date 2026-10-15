/**
 * How a strategy stores the session at a provider a login was started from, next to the login.
 */
export type FederatedSessionColumns = {
    /**
     * The name of the provider. Null for a login started some other way.
     */
    federatedProvider: string | undefined | null,
    /**
     * Identifies the person at the provider.
     */
    federatedSubjectKey: string | undefined | null,
    /**
     * Identifies their session at the provider.
     */
    federatedSessionKey: string | undefined | null,
    /**
     * What ends the session at the provider.
     */
    federatedLogout: string | undefined | null
};