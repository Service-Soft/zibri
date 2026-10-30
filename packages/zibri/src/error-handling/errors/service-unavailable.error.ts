import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when the application cannot take the request right now, but the caller is welcome
 * to try again.
 *
 * Answers 503: nothing went wrong and nothing needs investigating. A load balancer or a client
 * retrying treats it as "ask someone else, or ask again", such as while an instance shuts down.
 */
export class ServiceUnavailableError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.SERVICE_UNAVAILABLE, $ts`Service Unavailable`, options);
        this.name = 'ServiceUnavailableError';
    }
}