/**
 * What a token an identity provider issued says, once it is verified: the user it signs in as, and
 * what a request sending it has to prove on top.
 */
export type ProviderToken = {
    /**
     * The id of the user the identity the token names is linked to.
     */
    userId: string,
    /**
     * When the user signed in at the provider, when the token says.
     */
    authenticatedAt: Date | undefined,
    /**
     * When the token stops being accepted, when it says.
     */
    expiresAt: Date | undefined,
    /**
     * The RFC 7638 thumbprint of the DPoP key the token is bound to, if any.
     */
    dpopKeyThumbprint: string | undefined,
    /**
     * The SHA-256 thumbprint of the client certificate the token is bound to, if any.
     */
    certificateThumbprint: string | undefined
};