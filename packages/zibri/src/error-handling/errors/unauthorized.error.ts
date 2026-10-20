import { HttpError } from './http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when a user does something that he is not allowed to.
 */
export class UnauthorizedError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.UNAUTHORIZED, $ts`Unauthorized`, options);
        this.name = 'UnauthorizedError';
    }
}