import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { $ts } from '../../localization/translate.function';

/**
 * Thrown by a route guarded by \@Auth.require2fa that accepts a recent login in place of a second
 * factor, when the user has no second factor to present and did not log in recently enough.
 *
 * Separate from a missing second factor, though both answer 401: the client is told to have the user
 * log in again rather than to ask them for a code they do not have.
 */
export class ReauthenticationRequiredError extends UnauthorizedError {
    constructor(options?: ErrorOptions) {
        super($ts`Log in again to access this route.`, options);
        this.name = 'ReauthenticationRequiredError';
    }
}