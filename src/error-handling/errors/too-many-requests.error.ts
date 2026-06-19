import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when there have been too many requests in a too short amount of time.
 */
export class TooManyRequestsError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.TOO_MANY_REQUESTS, $ts`Too Many Requests`, options);
        this.name = 'TooManyRequestsError';
    }
}