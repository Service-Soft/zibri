/**
 * What a fake SAML identity provider is started with.
 */
export type FakeSamlProviderOptions = {
    /**
     * The entity id of the one service provider the identity provider knows, which its requests have
     * to name as their issuer.
     */
    serviceProviderEntityId: string,
    /**
     * What the identity provider signs: the assertion, the whole response, or both.
     * @default 'assertion'
     */
    signs?: 'assertion' | 'response' | 'both',
    /**
     * The certificate of the key of the service provider the assertion is encrypted to, PEM encoded.
     * Not encrypted, when undefined.
     * @default undefined
     */
    encryptsTo?: string,
    /**
     * The certificate of the key the service provider signs its requests with, PEM encoded. A request
     * that is not signed with it is answered with an error page. Requests need no signature, when undefined.
     * @default undefined
     */
    requiresRequestsSignedBy?: string,
    /**
     * Where the service provider takes logout requests and the answers to them. Logout requests are
     * answered with an error page, when undefined.
     * @default undefined
     */
    serviceProviderLogoutUrl?: string
};