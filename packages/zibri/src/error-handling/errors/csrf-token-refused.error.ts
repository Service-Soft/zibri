import { ForbiddenError } from './forbidden.error';
import { TranslatedString } from '../../localization/models/translated-string.model';

/**
 * An error to throw when a request changing something carries a valid cookie session, and not the
 * csrf token that goes with it.
 *
 * Answers 403: the session is fine, and logging in again does not help.
 * The client reads the current token, such as from `GET /auth/csrf-token`, and sends it.
 */
export class CsrfTokenRefusedError extends ForbiddenError {
    // the name tells the client to fetch the token rather than give up. It gives nothing away: the one
    // party it answers already holds the session, and a page of another site causing the request
    // cannot read the response
    constructor(message: TranslatedString | TranslatedString[], options?: ErrorOptions) {
        super(message, options);
        this.name = 'CsrfTokenRefusedError';
    }
}