/**
 * An algorithm access tokens can be signed with using a key pair.
 *
 * `ES256`, `ES384` and `ES512` take an elliptic curve key on P-256, P-384 and P-521 respectively.
 * `EdDSA` takes an Ed25519 key. `RS256` takes an RSA key of at least 2048 bits, and is there for
 * verifiers that accept nothing else.
 */
export type JwtAsymmetricAlgorithm = 'ES256' | 'ES384' | 'ES512' | 'EdDSA' | 'RS256';