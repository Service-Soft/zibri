import { FederatedLoginAction } from './federated-login-action.type';
import { FederatedLoginFailure } from './federated-login-failure.enum';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { $ts } from '../../../localization/translate.function';
import { AuditAction } from '../../../logging/audit-event.model';

/**
 * The options of a FederatedLoginError.
 */
export type FederatedLoginErrorOptions = ErrorOptions & {
    /**
     * What the login was for. A login by default.
     */
    action?: FederatedLoginAction
};

/**
 * Thrown when the answer of a provider to a login cannot be taken.
 *
 * Carries why, which the callback hands to the error url.
 */
export class FederatedLoginError extends UnauthorizedError {
    /**
     * What the login was for: a login, or connecting the provider to an account.
     */
    readonly action: FederatedLoginAction;

    constructor(
        /**
         * Why the login failed.
         */
        readonly failure: FederatedLoginFailure,
        options?: FederatedLoginErrorOptions
    ) {
        super($ts`The login could not be completed.`, options);
        this.name = 'FederatedLoginError';
        this.action = options?.action ?? AuditAction.LOGIN;
    }
}