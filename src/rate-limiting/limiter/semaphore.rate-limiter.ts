import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimiterConfigInput } from './rate-limiter-config.model';
import { TooManyRequestsError } from '../../error-handling/errors/too-many-requests.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { $ts } from '../../localization/translate.function';
import { Ms } from '../../utilities/ms';
import { NumberUtilities } from '../../utilities/number.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitWrapOptions, RateLimitWrapResult } from '../rate-limit-wrap-options.model';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservationRejectionReason } from '../reservation/rate-limit-reservation-rejection-reason.enum';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * Persisted state for a semaphore limiter – simply the number of currently acquired permits.
 */
export type SemaphoreState = BaseRateLimitState & {
    /**
     * The amount of currently acquired permits.
     */
    readonly current: number,
    /**
     * Permits set aside for pending reservations.
     */
    readonly reservedCount: number
};

/**
 * The configuration for a semaphore rate limiter.
 */
export type SemaphoreConfigInput = Omit<RateLimiterConfigInput<SemaphoreState>, 'maxReservationWaitMs'> & {
    /**
     * How long (ms) an idle key — no held or reserved permits — is kept
     * before being eligible for cleanup. Refreshed on every touch, same as
     * the other limiters' interval-based TTL. Defaults to 24 hours.
     */
    readonly idleTtlMs?: number,
    /**
     * The maximum number of unexpired reservations that may be queued for a
     * single key at once, regardless of how long each is estimated to wait.
     * A semaphore has no way to predict when a held permit will be released
     * (`computeReadyAtMs` reports `Infinity` whenever it's full), so a
     * time-based wait horizon can't bound the reservation queue the way it
     * does for the other limiters — this does instead. Defaults to `capacity`.
     */
    readonly maxPendingReservations?: number
};

/**
 * A concurrency limiter that behaves like a semaphore.
 *
 * - At most `max` concurrent operations are allowed per key.
 * - Permits are acquired via `consume` and **must be released** after the operation finishes.
 * - The `wrap` method handles acquire/release automatically.
 */
export class SemaphoreRateLimiter extends BaseRateLimiter<SemaphoreState> {
    private readonly idleTtlMs: number;
    private readonly maxPendingReservations: number;

    protected constructor(config: SemaphoreConfigInput) {
        super({
            reservationGracePeriodMs: (waitMs) => Math.max(5000, waitMs),
            maxReservationCount: config.capacity,
            ...config,
            // A semaphore can't estimate when a held permit will be released, so a
            // time-based wait horizon is meaningless here; see isWithinReservationHorizon
            // and checkAdditionalReservationLimits below for how the queue is actually bounded.
            maxReservationWaitMs: undefined
        });
        this.idleTtlMs = config.idleTtlMs ?? (Ms.HOUR * 24);
        this.maxPendingReservations = config.maxPendingReservations ?? config.capacity;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected initialAlgoState(now: number): SemaphoreState {
        return {
            current: 0,
            reservedCount: 0,
            reservations: [],
            expiresAtMs: now + this.idleTtlMs
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected debitCapacity(state: SemaphoreState, count: number): SemaphoreState {
        return { ...state, reservedCount: state.reservedCount + count };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected creditCapacity(state: SemaphoreState, count: number): SemaphoreState {
        return { ...state, reservedCount: Math.max(0, state.reservedCount - count) };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected computeReadyAtMs(
        state: SemaphoreState,
        _reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number {
        const totalNeeded: number = state.current + state.reservedCount + count;
        return totalNeeded <= this.config.capacity ? now : Infinity;
    }

    /**
     * A semaphore has no way to estimate when a held permit will be
     * released, so `computeReadyAtMs` reports `Infinity` whenever it's
     * full – that's not a "queue too long" signal the way it would be for
     * the other limiters, just "not yet". The queue is instead bounded by
     * {@link checkAdditionalReservationLimits}.
     * @returns Always `true`.
     */
    protected isWithinReservationHorizon(): boolean {
        return true;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected checkAdditionalReservationLimits(
        _state: SemaphoreState,
        pending: RateLimitReservation[]
    ): RateLimitReservationRejectionReason | undefined {
        return pending.length >= this.maxPendingReservations ? RateLimitReservationRejectionReason.QUEUE_TOO_LONG : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected recomputeReadyTimes(state: SemaphoreState, now: number): SemaphoreState {
        if (state.current + state.reservedCount <= this.config.capacity) {
            return {
                ...state,
                reservations: state.reservations.map(r => ({ ...r, readyAtMs: now }))
            };
        }
        return state;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async consume(key: string, count: number): Promise<RateLimitResult> {
        let allowed: boolean = false;
        let currentAfter: number = 0;

        const { sizeChanged } = await this.measureStoreOperation(
            'atomicUpdate',
            () => this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(Date.now());
                    const totalRequired: number = current.current + current.reservedCount + count;

                    if (totalRequired <= this.config.capacity) {
                        allowed = true;
                        currentAfter = current.current + count;
                    }
                    else {
                        allowed = false;
                        currentAfter = current.current;
                    }

                    return {
                        ...current,
                        current: currentAfter
                    };
                }
            )
        );

        if (sizeChanged) {
            void this.updateActiveKeysGauge();
        }

        const remaining: number = this.config.capacity - currentAfter;
        return {
            allowed,
            limit: this.config.capacity,
            remaining: Math.max(0, remaining),
            resetsAtMs: 0, // semaphore has no time‑based reset
            ...!allowed && { retryAtMs: 0 }
        };
    }

    /**
     * Release `count` permits for the given key.
     * Must be called after the guarded operation completes.
     * @param key - The key to release the permits of.
     * @param count - The amount of permits to release.
     */
    async release(key: string, count: number): Promise<void> {
        await this.measureStoreOperation('atomicUpdate', () => this.config.store.atomicUpdate(
            key,
            (current) => {
                if (!current) {
                    return this.initialAlgoState(Date.now());
                }
                const updated: SemaphoreState = {
                    ...current,
                    current: Math.max(0, current.current - count)
                };
                // Recompute ready times for pending reservations now that capacity has freed
                return this.recomputeReadyTimes(updated, Date.now());
            }
        ));
        void this.updateActiveKeysGauge();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrap<TArgs extends unknown[], V, TOptions extends RateLimitWrapOptions<TArgs> | undefined>(
        fn: (...args: TArgs) => V | Promise<V>,
        options?: TOptions
    ): (...args: TArgs) => RateLimitWrapResult<V, TOptions> {
        return async (...args: TArgs): Promise<V> => {
            const key: string = options?.keyFn ? await options.keyFn(...args) : 'global';
            const count: number = options?.countFn ? await options.countFn(...args) : 1;

            if (count === 0) {
                return await fn(...args);
            }

            // 1. Acquire permits
            let result: RateLimitResult;
            try {
                if (count < 0) {
                    throw new InternalError(
                        `A count of less than 0 was received for rate limiter "${this.config.name}", key: "${key}"`
                    );
                }
                const decisionStart: number = performance.now();
                result = await this.consume(key, count);
                this.metrics.remainingPercent.observe(
                    { limiter: this.config.name },
                    NumberUtilities.divide(result.remaining, result.limit).toNumber()
                );
                this.metrics.decisionDuration.observe(
                    { limiter: this.config.name },
                    NumberUtilities.subtract(performance.now(), decisionStart).toNumber()
                );
            }
            catch (error) {
                this.metrics.errors.increase({ limiter: this.config.name, operation: 'consume' });
                throw error;
            }

            if (result.allowed) {
                this.metrics.allowed.increase({ limiter: this.config.name });

                // 2. Execute the actual logic – always release permits afterwards
                try {
                    return await fn(...args);
                }
                finally {
                    await this.release(key, count);
                }
            }

            if (options?.reserveIfUnavailable === true) {
                const reservation: RateLimitReservationResult = await this.reserve(key, count);
                if (reservation.allowed) {
                    return reservation as V;
                }
            }

            this.metrics.blocked.increase({ limiter: this.config.name });
            // No meaningful retry time – 0 means “instant retry possible but likely still blocked”
            this.metrics.retryAfterMs.observe({ limiter: this.config.name }, 0);
            throw new TooManyRequestsError($ts`Rate limit was reached`, result);
        };
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
            const reservation: RateLimitReservation = current.reservations[index];
            if (current.current + reservation.count > this.config.capacity) {
                throw new InternalError(
                    `Reservation "${reservationInput.id}" for rate limiter "${this.config.name}", key: "${reservationInput.key}" `
                    + 'was committed before it was ready (readyAtMs is still in the future). Call waitForReservation first.'
                );
            }
            // Move from reservedCount to current (permit now actively held)
            return {
                ...current,
                current: current.current + reservation.count,
                reservedCount: current.reservedCount - reservation.count,
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
            const reservation: RateLimitReservation = current.reservations[index];
            // Refund reservedCount
            return this.recomputeReadyTimes(
                {
                    ...current,
                    reservedCount: Math.max(0, current.reservedCount - reservation.count),
                    reservations: current.reservations.filter((_, i) => i !== index)
                },
                Date.now()
            );
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async doReserve(key: string, count: number): Promise<RateLimitReservationResult> {
        const result: RateLimitReservationResult = await super.doReserve(key, count);
        if (result.allowed) {
            result.reservation.expiresAtMs = Date.now() + this.idleTtlMs;
        }
        return result;
    }
}