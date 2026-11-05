import { ForbiddenError } from './forbidden.error';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when a user whose account is locked after too many wrong two factor codes tries to
 * log in.
 *
 * Answers 403: the credentials were right, and sending them again does not help until the user's
 * second factors are reset.
 */
export class AccountLockedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`This account is locked after too many wrong two factor codes.`, options);
        this.name = 'AccountLockedError';
    }
}