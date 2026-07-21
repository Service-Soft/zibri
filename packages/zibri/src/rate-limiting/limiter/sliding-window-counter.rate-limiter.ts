import assert from 'node:assert';

import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { NumberUtilities } from '../../utilities/number.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * Result of rolling the sliding window forward to the current point in time.
 */
type RollWindowResult = {
    /**
     * The current window.
     */
    currentWindow: number,
    /**
     * The current window count.
     */
    currentCount: number,
    /**
     * The previous window count.
     */
    previousCount: number
};

/**
 * State for a sliding window counter rate limiter state.
 */
export type SlidingWindowCounterState = BaseRateLimitState & {
    /**
     * The current window.
     */
    readonly currentWindow: number,
    /**
     * The current window count.
     */
    readonly currentCount: number,
    /**
     * The previous window count.
     */
    readonly previousCount: number,
    /**
     * Slots taken by pending reservations.
     */
    readonly reservedCount: number
};

/**
 * A sliding window counter rate limiter.
 */
export class SlidingWindowCounterRateLimiter extends BaseRateLimiter<SlidingWindowCounterState> {

    protected constructor(
        private readonly intervalInMs: number,
        config: RateLimiterConfigInput<SlidingWindowCounterState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): SlidingWindowCounterState {
        const currentWindow: number = Math.floor(now / this.intervalInMs) * this.intervalInMs;
        return {
            currentWindow,
            currentCount: 0,
            previousCount: 0,
            reservedCount: 0,
            reservations: [],
            expiresAtMs: currentWindow + this.intervalInMs + 1
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: SlidingWindowCounterState, count: number): SlidingWindowCounterState {
        return { ...state, reservedCount: state.reservedCount + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: SlidingWindowCounterState, count: number): SlidingWindowCounterState {
        return { ...state, reservedCount: Math.max(0, state.reservedCount - count) };
    }

    /**
     * Rolls the window forward to `now`, applying the same shift/reset rules
     * as {@link consume}, without mutating the given state. Both `consume`
     * and `computeReadyAtMs` must agree on what "current usage" means as of
     * a given instant, so this is the single shared source of truth for it.
     * @param state - The stored algorithm state.
     * @param now - The current time (ms since epoch).
     * @returns The window start, current count and previous count as they
     * would be immediately after rolling forward to `now`.
     */
    private rollWindow(
        state: SlidingWindowCounterState,
        now: number
    ): RollWindowResult {
        const currentWindow: number = Math.floor(now / this.intervalInMs) * this.intervalInMs;
        const windowDiff: number = Math.floor(
            NumberUtilities.subtract(currentWindow, state.currentWindow)
                .dividedBy(this.intervalInMs)
                .toNumber()
        );

        let currentCount: number = state.currentCount;
        let previousCount: number = state.previousCount;
        if (windowDiff >= 2) {
            previousCount = 0;
            currentCount = 0;
        }
        else if (windowDiff === 1) {
            previousCount = currentCount;
            currentCount = 0;
        }

        return { currentWindow, currentCount, previousCount };
    }

    /**
     * The weight (0-1) the previous window's count still carries at `t`,
     * decaying linearly from 1 at the start of `currentWindow` to 0 at its end.
     * @param currentWindow - Start of the rolled-forward current window.
     * @param t - The point in time (ms since epoch) to evaluate the weight at.
     * @returns The previous window's weight at `t`.
     */
    private weightAt(currentWindow: number, t: number): number {
        const elapsed: number = NumberUtilities.subtract(t, currentWindow).toNumber();
        return NumberUtilities.subtract(1, NumberUtilities.divide(elapsed, this.intervalInMs)).toNumber();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: SlidingWindowCounterState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const window0: RollWindowResult = this.rollWindow(state, now);
        const weightNow: number = this.weightAt(window0.currentWindow, now);
        const estimatedNow: number = NumberUtilities
            .add(window0.currentCount, NumberUtilities.multiply(window0.previousCount, weightNow))
            .toNumber();
        // The part of the requirement that doesn't decay over time.
        const needed: number = NumberUtilities.add(state.reservedCount, count).toNumber();

        if (NumberUtilities.add(estimatedNow, needed).toNumber() <= this.config.capacity) {
            return now;
        }

        // Doesn't fit yet - find the earliest instant within window0 where
        // enough of the previous window's weight has decayed away.
        const rhs0: number = NumberUtilities.subtract(this.config.capacity, window0.currentCount).toNumber() - needed;
        if (window0.previousCount > 0 && rhs0 > 0) {
            const requiredWeight: number = NumberUtilities.divide(rhs0, window0.previousCount).toNumber();
            return Math.max(now, Math.ceil(
                NumberUtilities.add(
                    window0.currentWindow,
                    NumberUtilities.multiply(1 - requiredWeight, this.intervalInMs)
                ).toNumber()
            ));
        }

        // Not solvable within window0, even at zero previous-window weight
        // (window0.currentCount + reservedCount + count alone already
        // exceeds capacity). Roll forward once more: window0's currentCount
        // becomes window1's previousCount (nothing else will consume while
        // only this reservation is pending), and window1's own currentCount
        // starts at 0.
        const window1Start: number = window0.currentWindow + this.intervalInMs;
        const window1PreviousCount: number = window0.currentCount;
        const rhs1: number = NumberUtilities.subtract(this.config.capacity, needed).toNumber();

        if (rhs1 >= window1PreviousCount) {
            return window1Start;
        }
        if (window1PreviousCount > 0 && rhs1 > 0) {
            const requiredWeight: number = NumberUtilities.divide(rhs1, window1PreviousCount).toNumber();
            return Math.ceil(
                NumberUtilities.add(
                    window1Start,
                    NumberUtilities.multiply(1 - requiredWeight, this.intervalInMs)
                ).toNumber()
            );
        }

        // Even with zero decay contribution, reservedCount + count alone
        // exceeds capacity - no amount of waiting helps until existing
        // reservations are committed or cancelled.
        return Number.MAX_SAFE_INTEGER;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: SlidingWindowCounterState, now: number): SlidingWindowCounterState {
        const newReservations: RateLimitReservation[] = state.reservations.map(r => ({
            ...r,
            readyAtMs: this.computeReadyAtMs(state, [], r.count, now)
        }));
        const maxResExpiry: number = newReservations.length ? Math.max(...newReservations.map(r => r.expiresAtMs)) : 0;
        return {
            ...state,
            reservations: newReservations,
            expiresAtMs: Math.max(state.currentWindow + this.intervalInMs + 1, maxResExpiry)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();

        let allowed: boolean = false;
        let remaining: number = 0;
        let retryAtMs: number | undefined;
        let resetsAtMs: number = 0;

        const { sizeChanged } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(now);
                    const reservedCount: number = current.reservedCount;
                    const rolled: RollWindowResult = this.rollWindow(current, now);
                    const { currentWindow, previousCount } = rolled;
                    let currentCount: number = rolled.currentCount;

                    const weight: number = this.weightAt(currentWindow, now);
                    const estimated: number = NumberUtilities.add(currentCount, NumberUtilities.multiply(previousCount, weight)).toNumber();
                    const effectiveEstimated: number = NumberUtilities.add(estimated, reservedCount).toNumber();
                    const required: number = NumberUtilities.add(effectiveEstimated, count).toNumber();

                    if (required <= this.config.capacity) {
                        allowed = true;
                        currentCount = NumberUtilities.add(currentCount, count).toNumber();
                    }

                    const after: number = NumberUtilities.add(
                        currentCount,
                        NumberUtilities.add(
                            NumberUtilities.multiply(previousCount, weight),
                            reservedCount
                        )
                    ).toNumber();

                    remaining = Math.max(0, Math.floor(NumberUtilities.subtract(this.config.capacity, after).toNumber()));

                    resetsAtMs = NumberUtilities.add(currentWindow, this.intervalInMs).toNumber();

                    if (!allowed) {
                        retryAtMs = resetsAtMs;
                    }

                    const newExpiresAtMs: number = Math.max(
                        current.expiresAtMs,
                        currentWindow + this.intervalInMs + 1
                    );

                    return {
                        ...current,
                        currentWindow,
                        currentCount,
                        previousCount,
                        reservedCount,
                        expiresAtMs: newExpiresAtMs
                    };
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        if (!allowed) {
            assert(retryAtMs !== undefined);
            return { allowed, limit: this.config.capacity, remaining, resetsAtMs, retryAtMs };
        }

        return { allowed, limit: this.config.capacity, remaining, resetsAtMs };
    }

}