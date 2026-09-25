import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';
import { MimeType } from '../../http/mime-type.enum';
import { $ts } from '../../localization/translate.function';

/**
 * A http error to throw when the caller accepts nothing this route can produce.
 *
 * Answering anyway is the outcome worth avoiding: a client that asked for one representation and was
 * handed another at 200 hands it to a parser that cannot read it, and finds out at the parse rather
 * than at the request.
 */
export class NotAcceptableError extends HttpError {
    constructor(accept: string, readonly producibleMediaTypes: MimeType[], options?: ErrorOptions) {
        super(
            $ts`Nothing this route produces is acceptable to "${accept}". It answers ${producibleMediaTypes.join(', ')}.`,
            HttpStatus.NOT_ACCEPTABLE,
            $ts`Not Acceptable`,
            options
        );
        this.name = 'NotAcceptableError';
    }
}