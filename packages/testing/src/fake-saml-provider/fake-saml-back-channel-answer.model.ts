/**
 * What a service provider answered a logout request a fake SAML identity provider sent it server to
 * server, with the SOAP binding.
 */
export type FakeSamlBackChannelAnswer = {
    /**
     * The id of the logout request that was sent, which the answer has to name.
     */
    requestId: string,
    /**
     * The http status of the answer.
     */
    status: number,
    /**
     * Its content type, if it named one.
     */
    contentType: string | undefined,
    /**
     * Its body.
     */
    body: string,
    /**
     * Whether the logout response in it is signed with the key `requiresRequestsSignedBy` names.
     * False when no key is named.
     */
    signed: boolean
};