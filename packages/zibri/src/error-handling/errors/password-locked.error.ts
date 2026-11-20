import { $ts } from '../../localization/translate.function';
import { UnauthorizedError } from './unauthorized.error';

/**
 * An error to throw when the right password is presented for an account locked after too many wrong
 * ones in a row.
 *
 * Answers exactly like a wrong password, so that nobody learns which accounts exist, or are locked,
 * by trying. The audit trail is the one place the difference survives.
 */
export class PasswordLockedError extends UnauthorizedError {
    constructor(options?: ErrorOptions) {
        super($ts`Invalid email or password.`, options);
        this.name = 'PasswordLockedError';
    }
}