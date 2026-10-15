/**
 * A logout request a fake SAML identity provider was sent, as it read it.
 */
export type FakeSamlLogoutRequest = {
    /**
     * The id of the request, which the answer names.
     */
    id: string,
    /**
     * The entity id the request names as its issuer.
     */
    issuer: string,
    /**
     * The NameID of the user to log out.
     */
    nameId: string,
    /**
     * The session to end, if the request names one.
     */
    sessionIndex: string | undefined,
    /**
     * The relay state the request came with, which the answer carries back.
     */
    relayState: string | undefined,
    /**
     * Whether the request was signed, with a signature the provider checked.
     */
    signed: boolean
};