import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';

/**
 * A rate limit reservation, obtained via RateLimiterInterface.reserve.
 *
 * Unlike RateLimiterInterface.consume, a reservation debits its
 * capacity immediately, even if that capacity isn't available yet (up to the possible maximum of course).
 * `getReadyAtMs()` reports when it will be ready. This guarantees the reservation's
 * place in line: every other `consume()`/`reserve()` call against the same key
 * made afterward is computed against state that already accounts for it.
 *
 * Exactly one of `commit()` or `cancel()` must eventually be called to resolve
 * the reservation. Reservations left unresolved past their `expiresAtMs` are
 * automatically cancelled and refunded.
 */
export class RateLimitReservation extends BaseEntity {
    /**
     * The rate limit key this reservation was made against.
     */
    @Property.string()
    readonly key!: string;
    /**
     * The amount of the limited resource this reservation holds.
     */
    @Property.number({ min: 0 })
    readonly count!: number;
    /**
     * The time after which this reservation is treated as
     * abandoned and automatically cancelled if neither `commit()` nor
     * `cancel()` has been called by then.
     */
    @Property.number()
    expiresAtMs!: number;
    /**
     * The time at which the reservation is ready.
     * May move earlier, eg. If another reservation was cancelled, but never later.
     */
    @Property.number()
    readonly readyAtMs!: number;
}