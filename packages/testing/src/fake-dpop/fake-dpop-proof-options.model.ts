/**
 * What a proof of a fake DPoP key carries besides the method and url of its request.
 */
export type FakeDpopProofOptions = {
    /**
     * The access token the request sends, whose hash the proof carries as `ath`.
     */
    accessToken?: string,
    /**
     * The nonce the application issued, carried as `nonce`.
     */
    nonce?: string,
    /**
     * When the proof says it was issued. Now by default.
     */
    issuedAt?: Date,
    /**
     * The id of the proof, its `jti`. A new one by default.
     */
    jwtId?: string
};