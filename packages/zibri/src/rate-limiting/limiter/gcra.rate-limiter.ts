import { NumberUtilities } from '../../utilities/number.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * The persisted state for a single GCRA (Generic Cell Rate Algorithm) limiter.
 * Rather than tracking a token count, GCRA tracks a single "theoretical
 * arrival time" (TAT): the point in time until which the limiter should be
 * considered consumed. A fresh or fully-idle key behaves as if its TAT is
 * "now", i.e. At full capacity.
 */
export type GcraState = BaseRateLimitState & {
    /**
     * The theoretical arrival time (ms) — how far into the future consumed
     * capacity has pushed the limiter's clock.
     */
    readonly theoreticalArrivalTimeMs: number,
    /**
     * Tokens debited by pending reservations.
     */
    readonly reservedCount: number
};

/**
 * A GCRA (Generic Cell Rate Algorithm) rate limiter.
 * Behaves like a token bucket — a steady-state rate of `max` per
 * `intervalInMs`, with bursts of up to `max` allowed instantaneously — but
 * represents its state as a single timestamp instead of a token count plus a
 * last-refill time. There's nothing to lazily "refill": consuming just
 * compares the theoretical arrival time against now.
 */
export class GcraRateLimiter extends BaseRateLimiter<GcraState> {

    protected constructor(
        private readonly intervalInMs: number,
        config: RateLimiterConfigInput<GcraState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): GcraState {
        return {
            theoreticalArrivalTimeMs: now,
            reservedCount: 0,
            reservations: [],
            expiresAtMs: now + this.intervalInMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: GcraState, count: number): GcraState {
        return { ...state, reservedCount: state.reservedCount + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: GcraState, count: number): GcraState {
        return { ...state, reservedCount: Math.max(0, state.reservedCount - count) };
    }

    private rawTokens(state: GcraState, now: number): number {
        const burstMs: number = this.intervalInMs;
        const outstanding: number = Math.max(0, state.theoreticalArrivalTimeMs - now);
        const charged: number = Math.min(burstMs, outstanding);
        return Math.floor(
            NumberUtilities.multiply(burstMs - charged, this.config.capacity)
                .dividedBy(this.intervalInMs)
                .toNumber()
        );
    }

    private effectiveTokens(state: GcraState, now: number): number {
        return this.rawTokens(state, now) - state.reservedCount; // can be negative
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: GcraState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const available: number = this.effectiveTokens(state, now);
        if (available >= count) {
            return now;
        }
        const deficit: number = count - available;
        const waitMs: number = Math.ceil(
            NumberUtilities.multiply(deficit, this.intervalInMs)
                .dividedBy(this.config.capacity)
                .toNumber()
        );
        return now + waitMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: GcraState, now: number): GcraState {
        const baseTokens: number = this.rawTokens(state, now); // ignore reservedCount here
        let cumulativeReserved: number = 0;
        const updatedReservations: RateLimitReservation[] = state.reservations.map(r => {
            const available: number = baseTokens - cumulativeReserved;
            let readyAt: number = now;
            if (available < r.count) {
                const deficit: number = r.count - available;
                readyAt = now + Math.ceil(
                    NumberUtilities.multiply(deficit, this.intervalInMs)
                        .dividedBy(this.config.capacity)
                        .toNumber()
                );
            }
            cumulativeReserved += r.count;
            return { ...r, readyAtMs: readyAt };
        });
        return { ...state, reservations: updatedReservations };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commitReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const index: number = current.reservations.findIndex(r => r.id === reservationInput.id);
            if (index === -1) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const r: RateLimitReservation = current.reservations[index];

            // Charge the reservation: advance TAT by its emission interval
            const now: number = Date.now();
            const incrementMs: number = NumberUtilities
                .multiply(this.intervalInMs, r.count)
                .dividedBy(this.config.capacity)
                .toNumber();
            const newTat: number = Math.max(current.theoreticalArrivalTimeMs, now) + incrementMs;

            return {
                ...current,
                theoreticalArrivalTimeMs: newTat,
                reservedCount: current.reservedCount - r.count,
                reservations: current.reservations.filter((_, i) => i !== index)
            };
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const index: number = current.reservations.findIndex(r => r.id === reservationInput.id);
            if (index === -1) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const r: RateLimitReservation = current.reservations[index];

            const updated: GcraState = this.creditCapacity(current, r.count); // refund reservedCount
            const afterRemove: GcraState = {
                ...updated,
                reservations: current.reservations.filter((_, i) => i !== index)
            };
            return this.recomputeReadyTimes(afterRemove, Date.now());
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();
        const burstMs: number = this.intervalInMs;
        const incrementMs: number = NumberUtilities
            .multiply(this.intervalInMs, count)
            .dividedBy(this.config.capacity)
            .toNumber();

        let allowed: boolean = false;
        let tatAfterOp: number = now;
        let allowAtMs: number = now;

        const { sizeChanged, value } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    const state: GcraState = current ?? this.initialAlgoState(now);
                    const prevTat: number = state.theoreticalArrivalTimeMs;
                    const tatBase: number = Math.max(prevTat, now);
                    const newTat: number = tatBase + incrementMs;
                    allowAtMs = newTat - burstMs;

                    const effective: number = this.effectiveTokens(state, now); // uses current state
                    if (effective >= count && allowAtMs <= now) {
                        allowed = true;
                        tatAfterOp = newTat;
                    }
                    else {
                        allowed = false;
                        tatAfterOp = tatBase;
                    }

                    return {
                        ...state,
                        theoreticalArrivalTimeMs: tatAfterOp,
                        // reservedCount unchanged
                        expiresAtMs: Math.max(state.expiresAtMs, now + this.intervalInMs)
                    };
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        // Capacity still "owed" to the limiter, in ms, converted back into
        // resource units to report `remaining`.
        const outstanding: number = Math.max(0, value.theoreticalArrivalTimeMs - now);
        const charged: number = Math.min(burstMs, outstanding);
        const rawRemaining: number = Math.floor(
            NumberUtilities.multiply(burstMs - charged, this.config.capacity)
                .dividedBy(this.intervalInMs)
                .toNumber()
        );
        const remaining: number = Math.max(0, rawRemaining - value.reservedCount);

        return {
            allowed,
            limit: this.config.capacity,
            remaining,
            resetsAtMs: Math.ceil(value.theoreticalArrivalTimeMs),
            ...!allowed && { retryAtMs: Math.max(now, Math.ceil(allowAtMs)) }
        };
    }
}