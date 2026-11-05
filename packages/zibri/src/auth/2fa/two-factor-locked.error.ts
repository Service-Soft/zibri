import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { $ts } from '../../localization/translate.function';

// forbidden rather than unauthorized: no code of the locked methods is checked any more, so sending
// another one cannot help
/**
 * An error to throw when a user's second factor is locked after too many wrong codes in a row.
 *
 * Answers 403. A recovery code unlocks it, or a reset of the user's second factors.
 */
export class TwoFactorLockedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`Your second factor is locked after too many wrong codes. Use a recovery code, or have it reset.`, options);
        this.name = 'TwoFactorLockedError';
    }
}