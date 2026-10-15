/**
 * What an OAuth2 error says went wrong, as RFC 6749, RFC 7009, RFC 8707 and RFC 9449 name it.
 */
export enum OAuth2ErrorCode {
    /**
     * A parameter is missing, repeated or not understood.
     */
    INVALID_REQUEST = 'invalid_request',
    /**
     * The client could not be authenticated.
     */
    INVALID_CLIENT = 'invalid_client',
    /**
     * The client may not do this with the token it presented.
     */
    UNAUTHORIZED_CLIENT = 'unauthorized_client',
    /**
     * The grant type is not one the token endpoint issues tokens for.
     */
    UNSUPPORTED_GRANT_TYPE = 'unsupported_grant_type',
    /**
     * The client asked for a role its api key may not use.
     */
    INVALID_SCOPE = 'invalid_scope',
    /**
     * The client asked for a token for a service tokens are not issued for (RFC 8707).
     */
    INVALID_TARGET = 'invalid_target',
    /**
     * The token cannot be revoked (RFC 7009).
     */
    UNSUPPORTED_TOKEN_TYPE = 'unsupported_token_type',
    /**
     * The caller holds none of the roles the request needs.
     */
    INSUFFICIENT_SCOPE = 'insufficient_scope',
    /**
     * The DPoP proof of the request is missing where one is needed, or is not valid (RFC 9449).
     */
    INVALID_DPOP_PROOF = 'invalid_dpop_proof',
    /**
     * The DPoP proof of the request carries no nonce the application issued, or an expired one. The
     * answer carries a new one in its `DPoP-Nonce` header (RFC 9449).
     */
    USE_DPOP_NONCE = 'use_dpop_nonce'
}