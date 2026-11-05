import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $ts } from '../../localization/translate.function';

/**
 * An error to throw when the user send some content that is larger than allowed.
 */
export class ContentTooLargeError extends HttpError {
    constructor(message: TranslatedString | TranslatedString[] = $ts`request too large`, options?: ErrorOptions) {
        super(message, HttpStatus.CONTENT_TOO_LARGE, $ts`Content Too Large`, options);
        this.name = 'ContentTooLargeError';
    }
}