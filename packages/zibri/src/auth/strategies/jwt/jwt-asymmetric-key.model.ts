import { KeyObject } from 'node:crypto';

import { JwtAsymmetricAlgorithm } from './jwt-asymmetric-algorithm.type.ts';

/**
 * A key pair that access tokens are signed with, in place of a shared secret.
 *
 * A service that verifies your access tokens then needs only the public half, which your application
 * publishes as a JSON Web Key Set through `JwksController`.
 */
export type JwtAsymmetricKey = {
    /**
     * The algorithm tokens are signed with. It has to fit the key, which is checked when the
     * application starts.
     */
    readonly algorithm: JwtAsymmetricAlgorithm,
    /**
     * The key, as a `KeyObject` or PEM encoded.
     *
     * The key tokens are currently signed with has to be the private key. A previous key only
     * verifies, so its public key is enough.
     */
    readonly key: KeyObject | string
};