/**
 * Where a SAML identity provider signs users in and out, and what it signs its answers with, however
 * that was learned.
 */
export type SamlIdentityProviderSettings = {
    /**
     * The single sign-on url for the HTTP-Redirect binding.
     */
    signInUrl: string,
    /**
     * The certificates the identity provider signs with, PEM encoded.
     */
    certificates: string[],
    /**
     * The single logout url for the HTTP-Redirect binding, if the provider has one.
     */
    logoutUrl: string | undefined,
    /**
     * The single logout url for the HTTP-POST binding, if the provider has one: where a logout request
     * the provider sent is answered when it has no url for the HTTP-Redirect binding.
     */
    logoutPostUrl: string | undefined
};