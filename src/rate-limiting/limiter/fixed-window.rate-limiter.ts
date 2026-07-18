import { RateLimitResult } from '../rate-limit-result.model';
import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * The persisted state for a single fixed window.
 * The count resets to zero the first time a request arrives after the
 * window has expired; until then, requests accumulate against it.
 */
export type FixedWindowState = BaseRateLimitState & {
    /**
     * Count of the resource consumed so far in the current window.
     */
    readonly count: number,
    /**
     * Timestamp (ms) at which the current window started.
     */
    readonly windowStartMs: number,
    /**
     * Slots held by pending reservations.
     */
    readonly reservedCount: number
};

/**
 * A fixed window rate limiter.
 */
export class FixedWindowRateLimiter extends BaseRateLimiter<FixedWindowState> {

    protected constructor(
        private readonly intervalInMs: number,
        config: RateLimiterConfigInput<FixedWindowState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): FixedWindowState {
        return {
            count: 0,
            windowStartMs: now,
            reservedCount: 0,
            reservations: [],
            expiresAtMs: now + this.intervalInMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: FixedWindowState, count: number): FixedWindowState {
        return { ...state, reservedCount: state.reservedCount + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: FixedWindowState, count: number): FixedWindowState {
        return { ...state, reservedCount: Math.max(0, state.reservedCount - count) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: FixedWindowState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        // Determine the current window start.
        const windowStart: number = state.windowStartMs;
        const elapsed: number = now - windowStart;
        const windowExpired: boolean = elapsed >= this.intervalInMs;
        const currentCount: number = windowExpired ? 0 : state.count;
        const effectiveAvailable: number = this.config.capacity - currentCount - state.reservedCount;

        if (effectiveAvailable >= count) {
            return now; // can fit now
        }

        // Need a new window. At the next window boundary, count resets to 0.
        // Note: windowExpired is always false here, since effectiveAvailable
        // already equals capacityAfterReset (currentCount is 0) when it's true,
        // and that case is handled by the check above.
        const capacityAfterReset: number = this.config.capacity - state.reservedCount;
        if (capacityAfterReset >= count) {
            return windowStart + this.intervalInMs;
        }

        // Even after count reset, not enough capacity – reservation can never be fulfilled
        return Number.MAX_SAFE_INTEGER;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: FixedWindowState, now: number): FixedWindowState {
        const updatedReservations: RateLimitReservation[] = state.reservations.map(r => ({
            ...r,
            readyAtMs: this.computeReadyAtMs(state, [], r.count, now)
        }));
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

            const now: number = Date.now();
            const windowStart: number = current.windowStartMs;
            const elapsed: number = now - windowStart;
            const windowExpired: boolean = elapsed >= this.intervalInMs;
            const currentCount: number = windowExpired ? 0 : current.count;

            // Move from reservedCount to count in the current window.
            return {
                ...current,
                count: currentCount + r.count,
                windowStartMs: windowExpired ? now : windowStart,
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

            const afterCredit: FixedWindowState = this.creditCapacity(current, current.reservations[index].count);
            const afterRemove: FixedWindowState = {
                ...afterCredit,
                reservations: current.reservations.filter((_, i) => i !== index)
            };
            return this.recomputeReadyTimes(afterRemove, Date.now());
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();

        // These are set synchronously inside the updater before atomicUpdate resolves.
        // Safe because JS is single-threaded and the updater contains no awaits.
        let allowed: boolean = false;
        let countAfterOp: number = 0;
        let windowStartAfterOp: number = now;

        const { sizeChanged, value } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(now);
                    const windowStart: number = current.windowStartMs;
                    const elapsed: number = now - windowStart;
                    const windowExpired: boolean = elapsed >= this.intervalInMs;
                    const currentCount: number = windowExpired ? 0 : current.count;

                    windowStartAfterOp = windowExpired ? now : windowStart;

                    const effectiveAvailable: number = this.config.capacity - currentCount - current.reservedCount;

                    if (effectiveAvailable >= count) {
                        allowed = true;
                        countAfterOp = currentCount + count;
                    }
                    else {
                        allowed = false;
                        countAfterOp = currentCount;
                    }

                    return {
                        ...current,
                        count: countAfterOp,
                        windowStartMs: windowStartAfterOp,
                        // reservedCount unchanged
                        expiresAtMs: Math.max(current.expiresAtMs, now + this.intervalInMs)
                    };
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        const finalState: FixedWindowState = value;
        const remaining: number = Math.max(0, this.config.capacity - finalState.count - finalState.reservedCount);
        const resetsAtMs: number = windowStartAfterOp + this.intervalInMs;

        return {
            allowed,
            limit: this.config.capacity,
            remaining,
            resetsAtMs: windowStartAfterOp + this.intervalInMs,
            ...!allowed && { retryAtMs: resetsAtMs }
        };
    }
}