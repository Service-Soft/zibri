import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

/**
 * An error to throw when a user does something that he is not allowed to.
 */
export class UnauthorizedError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.UNAUTHORIZED, 'Unauthorized', options);
        this.name = 'UnauthorizedError';
    }
}