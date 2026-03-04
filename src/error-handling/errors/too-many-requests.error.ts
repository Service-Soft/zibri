import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';

/**
 * An error to throw when there have been too many requests in a too short amount of time.
 */
export class TooManyRequestsError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.TOO_MANY_REQUESTS, 'Too Many Requests', options);
        this.name = 'TooManyRequestsError';
    }
}