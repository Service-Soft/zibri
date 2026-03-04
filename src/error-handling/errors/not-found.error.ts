import { HttpError } from './http.error';
import { HttpStatus } from '../../http/http-status.enum';

/**
 * An error to throw when the requested resource could not be found.
 *
 * In contrast to the UnmatchedRouteError, this should be thrown when the endpoint actually exists (eg. /items/:id), but the resource was not found.
 * Eg. Because the id of the item is incorrect.
 */
export class NotFoundError extends HttpError {
    constructor(message: string | string[], options?: ErrorOptions) {
        super(message, HttpStatus.NOT_FOUND, 'Not Found', options);
        this.name = 'NotFoundError';
    }
}