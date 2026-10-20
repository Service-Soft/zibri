import { HttpError } from './http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when the user send some invalid data to the server.
 */
export class BadRequestError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.BAD_REQUEST, $ts`Bad Request`, options);
        this.name = 'BadRequestError';
    }
}