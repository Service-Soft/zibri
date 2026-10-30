import { ForbiddenError } from './forbidden.error';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when a deactivated user tries to log in.
 *
 * Answers 403: the credentials were right, and sending them again does not help until the user is
 * reactivated.
 */
export class AccountDeactivatedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`This account is deactivated.`, options);
        this.name = 'AccountDeactivatedError';
    }
}