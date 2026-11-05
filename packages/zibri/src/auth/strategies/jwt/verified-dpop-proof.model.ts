/**
 * A DPoP proof whose signature verified against the key it carries.
 */
export type VerifiedDpopProof = {
    /**
     * Its payload: the `jti`, `htm`, `htu` and `iat` it has to carry, and whatever else it does.
     */
    payload: Record<string, unknown>,
    /**
     * The RFC 7638 thumbprint of the public key it was signed with, which a token bound to the key
     * names as `jkt`.
     */
    jwkThumbprint: string
};