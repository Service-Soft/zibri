import { RateLimitReservationRejectionReason } from './rate-limit-reservation-rejection-reason.enum';
import { RateLimitReservation } from './rate-limit-reservation.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * Result for a rate limit reservation request that was not successful.
 */
export class FailedRateLimitReservationResult {
    /**
     * Whether the reservation was accepted.
     */
    @Property.boolean()
    allowed!: false;
    /**
     * Why the reservation was rejected.
     */
    @Property.string({ enum: RateLimitReservationRejectionReason })
    reason!: RateLimitReservationRejectionReason;
    /**
     * How long the wait would currently be, if `reason` is
     * RateLimitReservationRejectionReason.QUEUE_TOO_LONG.
     */
    @Property.number({ required: false, min: 0 })
    estimatedWaitMs?: number;
}

/**
 * Result for a rate limit reservation request that was successful.
 */
export class SuccessRateLimitReservationResult {
    /**
     * Whether the reservation was accepted.
     */
    @Property.boolean()
    allowed!: true;
    /**
     * The newly created reservation.
     */
    @Property.object({ cls: () => RateLimitReservation })
    reservation!: RateLimitReservation;
}

/**
 * The result for reserving from a rate limit.
 */
export type RateLimitReservationResult = FailedRateLimitReservationResult | SuccessRateLimitReservationResult;