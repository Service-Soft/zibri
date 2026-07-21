import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { KnownHeader } from '../../http/known-header.enum';
import { $ts } from '../../localization/translate.function';

/**
 * A http error to throw when the incoming request has an unsupported content type (eg. Formdata when the endpoint only supports application/json).
 */
export class UnsupportedMediaTypeError extends HttpError {
    constructor(mediaType: string, options?: ErrorOptions) {
        super(
            $ts`Unsupported ${KnownHeader.CONTENT_TYPE}: "${mediaType}"`,
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            $ts`Unsupported Media Type`,
            options
        );
        this.name = 'UnsupportedMediaTypeError';
    }
}