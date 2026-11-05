/**
 * What a token is bound to (RFC 7800): only a request presenting it may use the token. Names one of
 * them at least.
 */
export type JwtConfirmation = {
    /**
     * The SHA-256 thumbprint of the client certificate, base64url encoded (RFC 8705).
     */
    'x5t#S256'?: string,
    /**
     * The RFC 7638 thumbprint of the key the DPoP proofs of a request are signed with (RFC 9449).
     */
    jkt?: string
};

/**
 * Whether a value is a confirmation of the kind tokens are bound with here.
 * @param value - The value of a token's `cnf` claim.
 * @returns True when it names a certificate thumbprint, a key thumbprint or both, and nothing of
 * another type.
 */
export function isJwtConfirmation(value: unknown): value is JwtConfirmation {
    if (typeof value !== 'object' || value == undefined) {
        return false;
    }
    const certificate: unknown = 'x5t#S256' in value ? value['x5t#S256'] : undefined;
    const key: unknown = 'jkt' in value ? value.jkt : undefined;
    return (certificate != undefined || key != undefined)
        && (certificate == undefined || typeof certificate === 'string')
        && (key == undefined || typeof key === 'string');
}