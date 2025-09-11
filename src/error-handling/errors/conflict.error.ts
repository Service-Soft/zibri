import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

/**
 * An error to throw when the user send some invalid data to the server.
 */
export class ConflictError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.CONFLICT, 'Conflict', options);
        this.name = 'ConflictError';
    }
}