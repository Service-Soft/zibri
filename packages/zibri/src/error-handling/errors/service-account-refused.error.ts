import { $ts } from '../../localization/translate.function';
import { ForbiddenError } from './forbidden.error';

/**
 * An error to throw when a service account is about to get what only a person has: a login, a password, a passkey,
 * a linked identity, a second factor or an invitation.
 *
 * Answers 403: the account acts through its API keys alone, and asking again does not change that.
 */
export class ServiceAccountRefusedError extends ForbiddenError {
    constructor(options?: ErrorOptions) {
        super($ts`This account is a service account, which acts through its API keys only.`, options);
        this.name = 'ServiceAccountRefusedError';
    }
}