/**
 * How an api key proves itself, named as OAuth2 names the ways a client authenticates.
 */
export enum ApiKeyAuthenticationMethod {
    /**
     * By the key itself: sent in the api key header, or as the client secret at the token endpoint.
     */
    SECRET = 'secret',
    /**
     * By a jwt the client signs with its private key, at the token endpoint only (RFC 7523).
     */
    PRIVATE_KEY_JWT = 'private_key_jwt',
    /**
     * By a client certificate an authority issued, which the client certificate strategy finds the
     * key's user for, at the token endpoint only (RFC 8705).
     */
    TLS_CLIENT_AUTH = 'tls_client_auth',
    /**
     * By a client certificate the key names by its thumbprint, which may be self-signed, at the token
     * endpoint only (RFC 8705).
     */
    SELF_SIGNED_TLS_CLIENT_AUTH = 'self_signed_tls_client_auth'
}