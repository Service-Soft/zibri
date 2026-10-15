/**
 * An answer of a fake SAML identity provider: the form its page posts to the service provider.
 */
export type FakeSamlAnswer = {
    /**
     * Where the form is posted: the assertion consumer service of the service provider.
     */
    url: string,
    /**
     * The fields of the form: `SAMLResponse`, and `RelayState` when the request had one.
     */
    fields: URLSearchParams,
    /**
     * The response, decoded.
     */
    xml: string,
    /**
     * The session at the provider the answer names, which a logout request can end. Undefined when the
     * answer does not sign the user in.
     */
    sessionIndex: string | undefined
};