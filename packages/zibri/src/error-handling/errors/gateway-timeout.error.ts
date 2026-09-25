import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when something took longer to answer than it was given.
 *
 * Distinct from a 408 on purpose: a 408 says the caller was too slow to send its request, while this
 * says the request arrived fine and what it reached did not finish in time. It is the status every
 * proxy already answers for an upstream that kept it waiting, so a client retrying and a dashboard
 * counting slow endpoints both read it without being told anything new.
 */
export class GatewayTimeoutError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, HttpStatus.GATEWAY_TIMEOUT, $ts`Gateway Timeout`, options);
        this.name = 'GatewayTimeoutError';
    }
}