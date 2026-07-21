import assert from 'node:assert';

import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * State for a sliding window log rate limiter state.
 */
export type SlidingWindowLogState = BaseRateLimitState & {
    /**
     * The timestamps in ms.
     */
    readonly timestamps: readonly number[],
    /**
     * Total slots debited by pending reservations.
     */
    readonly reservedSlots: number
};

/**
 * A sliding window log rate limiter.
 */
export class SlidingWindowLogRateLimiter extends BaseRateLimiter<SlidingWindowLogState> {

    protected constructor(
        private readonly intervalInMs: number,
        config: RateLimiterConfigInput<SlidingWindowLogState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): SlidingWindowLogState {
        return {
            timestamps: [],
            reservedSlots: 0,
            reservations: [],
            expiresAtMs: now + this.intervalInMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: SlidingWindowLogState, count: number): SlidingWindowLogState {
        return { ...state, reservedSlots: state.reservedSlots + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: SlidingWindowLogState, count: number): SlidingWindowLogState {
        return { ...state, reservedSlots: Math.max(0, state.reservedSlots - count) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: SlidingWindowLogState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const effectiveCount: number = state.reservedSlots + count;
        return this.computeReadyTimeForCount(state.timestamps, effectiveCount, now);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: SlidingWindowLogState, now: number): SlidingWindowLogState {
        const newReservations: RateLimitReservation[] = state.reservations.map(reservation => {
            const readyAt: number = this.computeReadyTimeForCount(
                state.timestamps,
                reservation.count,
                now
            );
            return { ...reservation, readyAtMs: readyAt };
        });

        // Update expiresAtMs to the max of the window and the latest reservation expiry.
        const maxResExpiry: number = newReservations.length
            ? Math.max(...newReservations.map(r => r.expiresAtMs))
            : 0;
        return {
            ...state,
            reservations: newReservations,
            expiresAtMs: Math.max(now + this.intervalInMs, maxResExpiry)
        };
    }

    private computeReadyTimeForCount(
        timestamps: readonly number[],
        count: number,
        now: number
    ): number {
        if (count <= 0) {
            return now;
        }

        const cutoff: number = now - this.intervalInMs;
        // Only timestamps after the cutoff are relevant.
        const relevant: number[] = timestamps.filter(t => t > cutoff);

        // If we already have capacity for `count` more now, ready now.
        if (relevant.length + count <= this.config.capacity) {
            return now;
        }

        // We need to find the future moment when enough old timestamps have expired.
        // The window slides forward; the (relevant.length + count - capacity)‑th oldest timestamp
        // must expire (i.e., its time + intervalInMs).
        const needToExpire: number = relevant.length + count - this.config.capacity;
        // The timestamps array is sorted ascending.
        // The needToExpire‑th entry (1‑based) will expire at timestamp + interval.
        const expireTime: number = relevant[needToExpire - 1] + this.intervalInMs;
        return Math.max(now, expireTime);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        const now: number = Date.now();
        const cutoff: number = now - this.intervalInMs;

        let allowed: boolean = false;
        let remaining: number = 0;
        let retryAtMs: number | undefined;
        let resetsAtMs: number = now + this.intervalInMs;

        const { sizeChanged } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(now);
                    const timestamps: number[] = current.timestamps.filter(t => t > cutoff);

                    const availableSlots: number = this.config.capacity - timestamps.length - current.reservedSlots;

                    if (availableSlots >= count) {
                        allowed = true;
                        for (let i: number = 0; i < count; i++) {
                            timestamps.push(now);
                        }
                        remaining = Math.max(0, availableSlots - count);
                    }
                    else {
                        remaining = Math.max(0, availableSlots);
                    }

                    if (timestamps.length) {
                        resetsAtMs = timestamps[0] + this.intervalInMs;
                    }

                    if (!allowed) {
                        const activeCount: number = timestamps.length + current.reservedSlots;
                        const needToExpire: number = activeCount + count - this.config.capacity;
                        if (needToExpire > 0 && needToExpire <= timestamps.length) {
                            const sorted: number[] = [...timestamps].sort((a, b) => a - b);
                            retryAtMs = sorted[needToExpire - 1] + this.intervalInMs;
                        }
                        else {
                            retryAtMs = now + this.intervalInMs;
                        }
                    }

                    const newExpiresAtMs: number = Math.max(
                        current.expiresAtMs,
                        now + this.intervalInMs
                    );

                    return {
                        ...current,
                        timestamps,
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