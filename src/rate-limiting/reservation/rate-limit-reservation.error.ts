// rate-limit-reservation-error.model.ts
import { RateLimitReservationRejectionReason } from './rate-limit-reservation-rejection-reason.enum';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * Error to throw when reserving from a limit failed.
 */
export class RateLimitReservationError extends InternalError {
    /**
     * The reason that the rate limit reservation failed.
     */
    readonly reason: RateLimitReservationRejectionReason;
    /**
     * The estimated time before the reservation might be able to succeed.
     */
    readonly estimatedWaitMs?: number;

    constructor(reason: RateLimitReservationRejectionReason, estimatedWaitMs?: number) {
        super(`Reservation rejected: ${reason}`);
        this.name = 'RateLimitReservationError';
        this.reason = reason;
        this.estimatedWaitMs = estimatedWaitMs;
    }
}