import { KeyObject } from 'node:crypto';

import { JwtAsymmetricAlgorithm } from './jwt-asymmetric-algorithm.type';

/**
 * A key a jwt is signed or verified with, and the one algorithm a token checked against it may name.
 *
 * Build one with `JwtUtilities.resolveSigningKey` or `JwtUtilities.resolveVerificationKey`.
 */
export type JwtKey = {
    /**
     * A shared secret signs and verifies with hmac.
     */
    readonly algorithm: 'HS256',
    /**
     * The secret.
     */
    readonly secret: string,
    /**
     * A token signed with a secret carries no key id.
     */
    readonly kid?: undefined
} | {
    /**
     * A key pair signs with the private key and verifies with the public one.
     */
    readonly algorithm: JwtAsymmetricAlgorithm,
    /**
     * The private key when signing, the public key when verifying.
     */
    readonly key: KeyObject,
    /**
     * The id a token signed with this key carries in its header: the RFC 7638 thumbprint of the
     * public key.
     */
    readonly kid: string
};