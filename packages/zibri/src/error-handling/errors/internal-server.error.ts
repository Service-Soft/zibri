import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when something unexpected happened inside the server.
 */
export class InternalServerError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.INTERNAL_SERVER_ERROR, $ts`Internal Server Error`, options);
        this.name = 'InternalServerError';
    }
}