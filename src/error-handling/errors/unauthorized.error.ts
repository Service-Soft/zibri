import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

export class UnauthorizedError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.UNAUTHORIZED, 'Unauthorized', options);
        this.name = 'UnauthorizedError';
    }
}