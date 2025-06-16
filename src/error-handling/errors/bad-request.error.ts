import { HttpError } from './http.error';
import { HttpStatus } from '../../http';

export class BadRequestError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.BAD_REQUEST, 'Bad Request', options);
        this.name = 'BadRequestError';
    }
}