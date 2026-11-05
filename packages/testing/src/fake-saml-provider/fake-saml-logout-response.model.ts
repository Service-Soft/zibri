/**
 * A logout response a service provider posted to a fake SAML identity provider, as it read it.
 */
export type FakeSamlLogoutResponse = {
    /**
     * The id of the logout request it answers.
     */
    inResponseTo: string | undefined,
    /**
     * Its status, eg. `urn:oasis:names:tc:SAML:2.0:status:Success`.
     */
    status: string | undefined,
    /**
     * The relay state it came with.
     */
    relayState: string | undefined,
    /**
     * Whether it is signed with the key `requiresRequestsSignedBy` names. False when no key is named.
     */
    signed: boolean
};