import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when a user does something that he is not allowed to.
 */
export class UnauthorizedError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.UNAUTHORIZED, $ts`Unauthorized`, options);
        this.name = 'UnauthorizedError';
    }
}