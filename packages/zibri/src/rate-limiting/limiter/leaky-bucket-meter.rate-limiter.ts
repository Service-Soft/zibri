import { RateLimitResult } from '../rate-limit-result.model';
import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * Persisted state for the leaky bucket meter.
 */
export type LeakyBucketMeterState = BaseRateLimitState & {
    /**
     * Current water level. May be fractional.
     */
    readonly water: number,
    /**
     * Timestamp of the last leak calculation in ms.
     */
    readonly lastLeakMs: number,
    /**
     * Capacity reserved by pending reservations.
     */
    readonly reservedWater: number
};

/**
 * A rate limiter that uses a leaky bucket (meter variant).
 *
 * Water leaks out of the bucket at a constant rate (`max` per `intervalInMs`).
 * A request adds `count` units of water; it is allowed only if
 * `water + count ≤ maxCapacity` after leaking.
 */
export class LeakyBucketMeterRateLimiter extends BaseRateLimiter<LeakyBucketMeterState> {

    protected constructor(
        private readonly intervalInMs: number, // time window over which maxCapacity leaks out
        config: RateLimiterConfigInput<LeakyBucketMeterState>
    ) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): LeakyBucketMeterState {
        return {
            water: 0,
            lastLeakMs: now,
            reservedWater: 0,
            reservations: [],
            expiresAtMs: now + this.intervalInMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: LeakyBucketMeterState, count: number): LeakyBucketMeterState {
        return { ...state, reservedWater: state.reservedWater + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: LeakyBucketMeterState, count: number): LeakyBucketMeterState {
        return { ...state, reservedWater: Math.max(0, state.reservedWater - count) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: LeakyBucketMeterState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const leakRate: number = this.config.capacity / this.intervalInMs; // units/ms
        const elapsed: number = now - state.lastLeakMs;
        const waterAfterLeak: number = Math.max(0, state.water - (leakRate * elapsed));
        const totalVirtual: number = waterAfterLeak + state.reservedWater + count;
        if (totalVirtual <= this.config.capacity) {
            return now;
        }
        const excess: number = totalVirtual - this.config.capacity;
        const waitMs: number = Math.ceil(excess / leakRate);
        return now + waitMs;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: LeakyBucketMeterState, now: number): LeakyBucketMeterState {
        const leakRate: number = this.config.capacity / this.intervalInMs;
        const elapsed: number = now - state.lastLeakMs;
        const waterAfterLeak: number = Math.max(0, state.water - (leakRate * elapsed));
        let cumulativeReserved: number = 0;
        const newReservations: RateLimitReservation[] = state.reservations.map(r => {
            const totalVirtual: number = waterAfterLeak + cumulativeReserved + r.count;
            let readyAt: number = now;
            if (totalVirtual > this.config.capacity) {
                const excess: number = totalVirtual - this.config.capacity;
                readyAt = now + Math.ceil(excess / leakRate);
            }
            cumulativeReserved += r.count;
            return { ...r, readyAtMs: readyAt };
        });
        return { ...state, reservations: newReservations };
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
            return {
                ...current,
                water: current.water + r.count,
                reservedWater: current.reservedWater - r.count,
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
            const updated: LeakyBucketMeterState = this.creditCapacity(current, r.count); // refund reservedWater
            const afterRemove: LeakyBucketMeterState = {
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
        let allowed: boolean = false;
        let waterAfterOp: number = 0;
        let finalState: LeakyBucketMeterState | undefined;

        const { sizeChanged } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    const state: LeakyBucketMeterState = current ?? this.initialAlgoState(now);
                    const elapsedMs: number = Math.max(0, now - state.lastLeakMs);
                    const leakRate: number = this.config.capacity / this.intervalInMs;
                    const leaked: number = leakRate * elapsedMs;
                    const waterAfterLeak: number = Math.max(0, state.water - leaked);
                    const totalRequired: number = waterAfterLeak + state.reservedWater + count;

                    if (totalRequired <= this.config.capacity) {
                        allowed = true;
                        waterAfterOp = waterAfterLeak + count;
                    }
                    else {
                        allowed = false;
                        waterAfterOp = waterAfterLeak;
                    }

                    const newState: LeakyBucketMeterState = {
                        ...state,
                        water: waterAfterOp,
                        lastLeakMs: now,
                        // reservedWater unchanged
                        expiresAtMs: Math.max(state.expiresAtMs, now + this.intervalInMs)
                    };
                    finalState = newState;
                    return newState;
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        const effectiveWater: number = finalState ? finalState.water + finalState.reservedWater : 0;
        const freeCapacity: number = Math.max(0, this.config.capacity - effectiveWater);
        const leakRate: number = this.config.capacity / this.intervalInMs;
        const drainTimeMs: number = finalState && finalState.water > 0
            ? Math.ceil(finalState.water / leakRate)
            : 0;

        if (!allowed) {
            const requiredDrain: number = (finalState ? finalState.water + finalState.reservedWater + count : count) - this.config.capacity;
            const retryAfterMs: number = requiredDrain > 0 ? Math.ceil(requiredDrain / leakRate) : 0;

            return {
                allowed: false,
                limit: this.config.capacity,
                remaining: Math.floor(freeCapacity),
                resetsAtMs: now + drainTimeMs,
                retryAtMs: now + retryAfterMs
            };
        }

        return {
            allowed: true,
            limit: this.config.capacity,
            remaining: Math.floor(freeCapacity),
            resetsAtMs: now + drainTimeMs
        };
    }
}