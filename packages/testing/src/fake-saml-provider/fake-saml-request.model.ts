/**
 * A request a fake SAML identity provider was sent, as it read it.
 */
export type FakeSamlRequest = {
    /**
     * The id of the request, which the answer names.
     */
    id: string,
    /**
     * The entity id the request names as its issuer.
     */
    issuer: string,
    /**
     * Where the answer is to be posted.
     */
    assertionConsumerServiceUrl: string,
    /**
     * Whether the user is to sign in again rather than reuse a session at the provider.
     */
    forceAuthn: boolean,
    /**
     * The NameID format asked for, if any.
     */
    nameIdFormat: string | undefined,
    /**
     * The relay state the request came with, which the answer carries back.
     */
    relayState: string | undefined,
    /**
     * Whether the request was signed, with a signature the provider checked.
     */
    signed: boolean
};