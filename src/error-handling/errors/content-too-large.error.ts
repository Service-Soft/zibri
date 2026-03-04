import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';

/**
 * An error to throw when the user send some content that is larger than allowed.
 */
export class ContentTooLargeError extends HttpError {
    constructor(message: string | string[] = 'request too large', options?: ErrorOptions) {
        super(message, HttpStatus.CONTENT_TOO_LARGE, 'Content Too Large', options);
        this.name = 'ContentTooLargeError';
    }
}