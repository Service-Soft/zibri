import { HttpError } from './http.error.ts';
import { HttpStatus } from '../../http/http-status.enum.ts';
import { TranslatedString } from '../../localization/models/translated-string.model.ts';
import { $ts } from '../../localization/translate.function.ts';

/**
 * An error to throw when the application cannot take the request right now, but the caller is welcome
 * to try again.
 *
 * Distinct from a 500 on purpose: nothing went wrong and nothing needs investigating. A load balancer
 * or a client retrying should treat it as "ask someone else, or ask again", which is exactly what an
 * instance that has started shutting down wants to say.
 */
export class ServiceUnavailableError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.SERVICE_UNAVAILABLE, $ts`Service Unavailable`, options);
        this.name = 'ServiceUnavailableError';
    }
}