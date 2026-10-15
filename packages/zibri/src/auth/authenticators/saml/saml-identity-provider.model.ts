/**
 * Where a SAML identity provider signs users in, and what it signs its answers with: read from the
 * metadata it publishes, or given here.
 */
export type SamlIdentityProvider = {
    /**
     * The url the identity provider publishes its metadata at. Read when it is first needed, and again
     * once a day, so certificates the provider rotates are picked up.
     */
    metadataUrl: string
} | {
    /**
     * Where the browser is sent to sign in: the identity provider's single sign-on url for the
     * HTTP-Redirect binding.
     */
    signInUrl: string,
    /**
     * The certificates the identity provider signs with, PEM encoded. List the next one next to the
     * current one before the provider rotates it.
     */
    certificates: string[],
    /**
     * Where the browser is sent to sign out at the identity provider: its single logout url. None
     * when the provider has none.
     */
    logoutUrl?: string
};