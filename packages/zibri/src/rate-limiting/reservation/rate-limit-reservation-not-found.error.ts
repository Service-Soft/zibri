import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error to throw when a rate limit reservation for the given key and id could not be found.
 */
export class RateLimitReservationNotFoundError extends InternalError {
    constructor(key: string, id: string) {
        super(`Rate Limit Reservation with key "${key}" and id "${id}" not found`);
        this.name = 'RateLimitReservationNotFoundError';
    }
}