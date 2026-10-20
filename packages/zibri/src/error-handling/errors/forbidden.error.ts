import { HttpError } from './http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when the caller has been identified, but is not allowed to do this.
 *
 * In contrast to the UnauthorizedError, this says nothing is wrong with the credential, so sending a better one cannot help.
 * That difference is what every http client acts on: a 401 means "refresh and retry", which turns a refused role into an
 * endless refresh loop when it is answered with one. Eg. A logged in user without the required role.
 */
export class ForbiddenError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.FORBIDDEN, $ts`Forbidden`, options);
        this.name = 'ForbiddenError';
    }
}