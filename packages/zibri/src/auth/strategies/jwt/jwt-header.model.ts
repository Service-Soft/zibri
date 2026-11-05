/**
 * The header of a jwt.
 */
export type JwtHeader = {
    /**
     * The algorithm the token is signed with.
     */
    alg: string,
    /**
     * The id of the key the token is signed with. Absent for a token signed with a shared secret.
     */
    kid?: string,
    /**
     * The type of the token.
     */
    typ?: string
};