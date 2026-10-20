import { InternalError } from '../../../error-handling/internal-error.model.ts';

/**
 * An error to throw when the access token key or the refresh token secret has not been configured.
 *
 * There is deliberately no default: a framework that invented one would ship every application the
 * same signing key, and anyone who read the source could mint tokens for all of them.
 */
export class MissingJwtSecretError extends InternalError {
    constructor(secret: 'accessTokenKey' | 'refreshTokenSecret', options?: ErrorOptions) {
        super(
            [
                `No ${secret} configured on ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT.`,
                'It has no default, because a shared one would let anyone with the source mint tokens.'
            ],
            options
        );
        this.name = 'MissingJwtSecretError';
    }
}