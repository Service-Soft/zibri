import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';

/**
 * An error to throw when the user send some invalid data to the server.
 */
export class BadRequestError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.BAD_REQUEST, 'Bad Request', options);
        this.name = 'BadRequestError';
    }
}