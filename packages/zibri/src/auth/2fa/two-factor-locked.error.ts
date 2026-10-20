import { ForbiddenError } from '../../error-handling/errors/forbidden.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when a user's second factor is locked after too many wrong codes in a row.
 *
 * Forbidden rather than unauthorized: no code of the locked methods is checked any more, so sending
 * another one cannot help. A recovery code can, or a reset of the user's second factors.
 */
export class TwoFactorLockedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`Your second factor is locked after too many wrong codes. Use a recovery code, or have it reset.`, options);
        this.name = 'TwoFactorLockedError';
    }
}