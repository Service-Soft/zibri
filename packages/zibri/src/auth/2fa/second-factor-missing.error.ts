import { UnauthorizedError } from '../../error-handling/errors/unauthorized.error';
import { TranslatedString } from '../../localization/models/translated-string.model';

/**
 * Thrown by a two factor method when the request carries no second factor for it, such as a route
 * guarded by `@Auth.require2fa` called without its header.
 *
 * Answers 401 like every refused second factor, with a name of its own: the client asks its user for a
 * code and sends the request again, instead of refreshing a login that is fine. A method you write
 * throws this when its header is missing.
 */
export class SecondFactorMissingError extends UnauthorizedError {
    // the caller is logged in already, and which routes need a second factor is in the api's own
    // document, so the name tells nobody anything they could not read anyway
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, options);
        this.name = 'SecondFactorMissingError';
    }
}