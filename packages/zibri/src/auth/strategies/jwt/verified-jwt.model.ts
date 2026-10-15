/**
 * A jwt this application signed, verified, and what it says.
 */
export type VerifiedJwt = {
    /**
     * Its payload, which verifying proves nobody changed. Not checked for its shape: that is a question
     * of the kind of token, which whoever reads it answers.
     */
    payload: Record<string, unknown>,
    /**
     * When it was issued, in seconds since the epoch.
     */
    issuedAt: number,
    /**
     * When it expires, in seconds since the epoch.
     */
    expiresAt: number,
    /**
     * Who it is for.
     */
    audience: string[]
};