import { ForbiddenError } from './forbidden.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when a user whose account is locked after too many wrong two factor codes tries to
 * log in.
 *
 * Forbidden rather than unauthorized: the credentials were right, so sending them again cannot help
 * until the user's second factors are reset.
 */
export class AccountLockedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`This account is locked after too many wrong two factor codes.`, options);
        this.name = 'AccountLockedError';
    }
}