import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

export class NotFoundError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.NOT_FOUND_ERROR, 'Not Found', options);
        this.name = 'NotFoundError';
    }
}