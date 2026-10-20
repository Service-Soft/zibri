import { ForbiddenError } from './forbidden.error.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when a deactivated user tries to log in.
 *
 * Forbidden rather than unauthorized: the credentials were right, so sending them again cannot help
 * until the user is reactivated.
 */
export class AccountDeactivatedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`This account is deactivated.`, options);
        this.name = 'AccountDeactivatedError';
    }
}