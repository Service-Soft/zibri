/**
 * Which tokens of an OpenID Connect provider a request may send as its credential, read by
 * `ProviderTokenAuthStrategy`.
 */
export type OidcBearerTokens = {
    /**
     * The audiences the api is known by at the provider: an access token whose `aud` names one of them
     * is taken. Empty to take no access tokens.
     */
    accessTokenAudiences: string[],
    /**
     * The `typ` an access token has to carry in its header. `'at+jwt'` takes only access tokens as RFC
     * 9068 marks them, which no ID token is. `'any'` takes whatever it carries, for a provider marking
     * its access tokens `JWT`, and leaves the audience alone to tell them apart from its ID tokens.
     */
    accessTokenType: 'at+jwt' | 'any',
    /**
     * The clients whose ID tokens are taken: an ID token whose `aud` names one of them, such as the
     * client a mobile app signs in as. Empty to take no ID tokens.
     */
    idTokenAudiences: string[]
};