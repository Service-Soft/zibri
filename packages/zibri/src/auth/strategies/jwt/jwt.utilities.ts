import { sign, verify, Secret, SignOptions } from 'jsonwebtoken';

import { EncodedJwt } from './encoded-jwt-access-token.model';

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
     * Asynchronously verify a given token using a secret to get a decoded token.
     *
     * Three things are pinned rather than left to the library's defaults:
     *
     * - **`algorithms`.** jsonwebtoken v9 already refuses unsigned tokens and defaults to the hmac
     * family for a symmetric key, so algorithm confusion is blocked - by the dependency. Naming the
     * algorithm here means a major bump, a fork or a resolution override cannot quietly reopen it.
     * - **`issuer`.** Two applications sharing a secret would otherwise accept each other's tokens.
     * - **`maxAge`**, when given, on top of the token's own `exp`.
     *
     * The payload comes back as `unknown`. What verification establishes is that this application
     * issued the token and nobody changed it since - not that the contents are shaped the way the
     * caller expects, which is a separate question with a separate answer per token type.
     *
     * More than one secret may be handed in, which is what makes replacing a secret possible without
     * invalidating every token in circulation. They are tried in order and the first that verifies
     * wins, so put the current one first. A token only has to verify against one of them - which is
     * the point, and the reason a secret must be dropped from the list once the tokens it signed
     * have expired.
     * @param token - The token to verify.
     * @param secrets - The secrets it may have been signed with, current one first.
     * @param issuer - Who the token must say issued it.
     * @returns The decoded token, or undefined if it does not verify against any of the secrets.
     */
    static async verify(
        token: string,
        secrets: Secret[],
        issuer: string
    ): Promise<EncodedJwt | undefined> {
        return new Promise((resolve) => {
            for (const secret of secrets) {
                try {
                    const jwt: EncodedJwt = verify(token, secret, {
                        complete: true,
                        algorithms: ['HS256'],
                        issuer
                    });
                    resolve(jwt);
                    return;
                }
                catch {
                    continue;
                }
            }
            resolve(undefined);
        });
    }
}