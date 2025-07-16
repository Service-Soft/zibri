import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

/**
 * An error to throw when something unexpected happened inside the server.
 */
export class InternalServerError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.INTERNAL_SERVER_ERROR, 'Internal Server Error', options);
        this.name = 'InternalServerError';
    }
}