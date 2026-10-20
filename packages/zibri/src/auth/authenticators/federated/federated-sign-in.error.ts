import { FederatedSignInAction } from './federated-sign-in-action.type.ts';
import { FederatedSignInFailure } from './federated-sign-in-failure.enum.ts';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error.ts';
import { $ts } from '../../../localization/translate.function.ts';
import { AuditAction } from '../../../logging/audit-event.model.ts';

/**
 * The options of a FederatedSignInError.
 */
type FederatedSignInErrorOptions = ErrorOptions & {
    /**
     * What the sign-in was for. A login by default.
     */
    action?: FederatedSignInAction
};

/**
 * Thrown when the answer of a provider to a sign-in cannot be taken.
 *
 * Carries why, which the callback hands to the error url.
 */
export class FederatedSignInError extends UnauthorizedError {
    /**
     * What the sign-in was for: a login, or connecting the provider to an account.
     */
    readonly action: FederatedSignInAction;

    constructor(
        /**
         * Why the sign-in failed.
         */
        readonly failure: FederatedSignInFailure,
        options?: FederatedSignInErrorOptions
    ) {
        super($ts`The sign-in could not be completed.`, options);
        this.name = 'FederatedSignInError';
        this.action = options?.action ?? AuditAction.LOGIN;
    }
}