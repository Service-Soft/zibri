import { sign, verify, Secret, SignOptions } from 'jsonwebtoken';

import { EncodedAccessToken } from './encoded-access-token.model';

/**
 * Encapsulates functionality of the jsonwebtoken package.
 */
export abstract class JwtUtilities {
    /**
     * Asynchronously sign the given payload into a JSON Web Token string payload.
     * @param payload - Any info that should be put inside the token.
     * @param secret - The secret used to encrypt the token.
     * @param options - Additional options like "expiresIn".
     * @returns A promise of the jwt.
     */
    static async sign(
        payload: string | Buffer | object,
        secret: Secret,
        options?: SignOptions
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            try {
                const jwtValue: string = sign(payload, secret, options);
                resolve(jwtValue);
            }
            catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Asynchronously verify given token using a secret or a public key to get a decoded token.
     * @param token - The token to encode.
     * @param secret - The secret to encode the token with.
     * @returns The encoded token.
     */
    static async verify<Role extends string>(
        token: string,
        secret: Secret
    ): Promise<EncodedAccessToken<Role> | undefined> {
        return new Promise((resolve) => {
            try {
                const jwt: EncodedAccessToken<Role> = verify(token, secret, { complete: true }) as EncodedAccessToken<Role>;
                resolve(jwt);
            }
            catch {
                resolve(undefined);
            }
        });
    }
}