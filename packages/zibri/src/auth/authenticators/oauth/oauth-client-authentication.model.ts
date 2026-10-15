/**
 * A client secret, or what resolves it before every exchange, for a secret that is signed and expires
 * like Apple's.
 */
export type OAuthClientSecret = string | (() => Promise<string>);

/**
 * How the application proves to a provider which client it is, when it exchanges a code for tokens.
 *
 * The provider says which methods it accepts, and which one a client uses is set when the client is
 * registered there.
 */
export type OAuthClientAuthentication = {
    /**
     * The client secret, sent as http basic authentication.
     */
    method: 'client_secret_basic',
    /**
     * The client secret.
     */
    clientSecret: OAuthClientSecret
} | {
    /**
     * The client secret, sent in the request body.
     */
    method: 'client_secret_post',
    /**
     * The client secret.
     */
    clientSecret: OAuthClientSecret
} | {
    /**
     * A JWT signed with the client's private key, whose public key the provider holds.
     */
    method: 'private_key_jwt',
    /**
     * The private key, as `importPKCS8` of `jose` reads it.
     */
    privateKey: CryptoKey,
    /**
     * The id the provider knows the key by, if it holds several.
     */
    keyId: string | undefined
};