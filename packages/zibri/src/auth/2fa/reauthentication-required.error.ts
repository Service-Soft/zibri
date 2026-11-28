import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * Thrown by a route guarded by \@Auth.require2fa that accepts a recent login in place of a second
 * factor, when the user has no second factor to present and did not log in recently enough.
 *
 * Answers 401, like a missing second factor, and tells the client to have the user log in again.
 */
export class ReauthenticationRequiredError extends UnauthorizedError {
    // the message second, so that an error created with its options alone stays as it was
    constructor(options?: ErrorOptions, message: TranslatedString = $ts`Log in again to access this route.`) {
        super(message, options);
        this.name = 'ReauthenticationRequiredError';
    }
}