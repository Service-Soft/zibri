/**
 * What an access token a client is issued may do.
 */
export type ClientAccessTokenGrant = {
    /**
     * The id of the client's api key.
     */
    clientId: string,
    /**
     * The roles the token may use.
     */
    roles: string[],
    /**
     * The tenant the client's api key is bound to, or undefined for a key acting in every tenant its
     * user is a member of.
     */
    tenantId: string | undefined,
    /**
     * Who the token is for.
     */
    audience: string[],
    /**
     * The SHA-256 thumbprint of the client certificate the token is bound to, or undefined for a token
     * bound to none.
     */
    certificateThumbprint: string | undefined,
    /**
     * The RFC 7638 thumbprint of the DPoP key the token is bound to, or undefined for a token bound to
     * none.
     */
    dpopKeyThumbprint: string | undefined
};