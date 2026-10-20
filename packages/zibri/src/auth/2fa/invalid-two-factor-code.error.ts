import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * Thrown by a two factor method when the caller presented a code and it was wrong.
 *
 * Only this counts as a failed attempt. A request that carries no code, a code of the wrong shape or
 * a code that was already used is refused as well, but none of them is a guess, so none of them makes
 * the user wait. A method you write throws this for a wrong code and its own error for everything
 * else.
 */
export class InvalidTwoFactorCodeError extends UnauthorizedError {
    constructor(options?: ErrorOptions) {
        super($ts`The provided two factor code is invalid.`, options);
        this.name = 'InvalidTwoFactorCodeError';
    }
}