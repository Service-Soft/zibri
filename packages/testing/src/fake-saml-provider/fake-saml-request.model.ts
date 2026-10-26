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
     * Whether the user is to log in again rather than reuse a session at the provider.
     */
    forceAuthn: boolean,
    /**
     * The NameID format asked for, if any.
     */
    nameIdFormat: string | undefined,
    /**
     * The classes of authentication the request asks for, as its RequestedAuthnContext names them.
     * Empty when it asks for none.
     */
    requestedAuthnContext: string[],
    /**
     * The relay state the request came with, which the answer carries back.
     */
    relayState: string | undefined,
    /**
     * Whether the request was signed, with a signature the provider checked.
     */
    signed: boolean
};