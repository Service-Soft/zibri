
import assert from 'node:assert';

import { exhaustMap, filter, firstValueFrom, from, interval, Observable, take, throwError, timeout } from 'rxjs';

import { RateLimiterConfig } from './rate-limiter-config.model';
import { RateLimiterInterface } from './rate-limiter.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { TooManyRequestsError } from '../../error-handling/errors/too-many-requests.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { NumberUtilities } from '../../utilities/number.utilities';
import { TimeoutError } from '../../utilities/promise.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitWrapOptions, RateLimitWrapResult } from '../rate-limit-wrap-options.model';
import { RateLimiterMetrics } from '../rate-limiter-metrics.model';
import { RateLimitReservationNotFoundError } from '../reservation/rate-limit-reservation-not-found.error';
import { RateLimitReservationRejectionReason } from '../reservation/rate-limit-reservation-rejection-reason.enum';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservationError } from '../reservation/rate-limit-reservation.error';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

const defaultKey: string = 'global';

/**
 * Base class shared by all rate limiters. Implements everything besides the actual consume method.
 */
export abstract class BaseRateLimiter<TState extends BaseRateLimitState> implements RateLimiterInterface<TState>, OnAppInit {
    private _metrics: RateLimiterMetrics | undefined;

    private readonly inFlightReservationWaits: Map<string, Promise<void>> = new Map();

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The metrics service.
     */
    protected get metricsService(): MetricsServiceInterface {
        return inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The limiter metrics.
     */
    protected get metrics(): RateLimiterMetrics {
        this._metrics ??= this.initMetrics();
        return this._metrics;
    }

    constructor(readonly config: RateLimiterConfig<TState>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        let total: number = 0;
        const now: number = Date.now();
        for (const state of await this.config.store.getAll()) {
            if (state.expiresAtMs <= now) {
                continue;
            }
            total += state.reservations.filter(r => r.expiresAtMs > now).length;
        }
        this.metrics.activeReservations.set({ limiter: this.config.name }, total);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commitReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const reservation: RateLimitReservation | undefined = current.reservations.find(r => r.id === reservationInput.id);
            if (!reservation) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            // Remove the reservation; capacity stays debited
            return { ...current, reservations: current.reservations.filter((r) => r.id !== reservation.id) };
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelReservation(reservationInput: RateLimitReservation): Promise<void> {
        await this.config.store.atomicUpdate(reservationInput.key, (current) => {
            if (!current) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            const reservation: RateLimitReservation | undefined = current.reservations.find(r => r.id === reservationInput.id);
            if (!reservation) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            current = {
                ...current,
                reservations: current.reservations.filter((r) => r.id !== reservation.id)
            };
            current = this.creditCapacity(current, reservation.count);
            current = this.recomputeReadyTimes(current, Date.now());
            return current;
        });
        this.recordReservationClosed();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async waitForReservation(reservationInput: RateLimitReservation, timeoutMs: number): Promise<void> {
        const now: number = Date.now();
        // calculate point in time that the timeout will happen
        const timeoutPointMs: number = Math.min(now + timeoutMs, reservationInput.expiresAtMs);

        if (timeoutPointMs <= now) {
            throw new InternalError('The given reservation is expired');
        }

        await this.runSingleFlight(`${reservationInput.id}@${timeoutPointMs}`, async () => {
            const reservation: RateLimitReservation | undefined = await this.getReservation(reservationInput.id, reservationInput.key);
            if (!reservation) {
                throw new RateLimitReservationNotFoundError(reservationInput.key, reservationInput.id);
            }
            if (reservation.readyAtMs <= now) {
                return;
            }

            // Create a polling stream that checks readyAtMs every 100ms
            const ready$: Observable<number> = interval(100).pipe(
                exhaustMap(() => from(this.getReservationReadyAtMs(reservationInput))),
                filter(readyAt => Date.now() >= readyAt),
                take(1)
            );

            const withTimeout: Observable<number> = ready$.pipe(
                timeout({
                    first: Math.max(0, timeoutPointMs - Date.now()),
                    with: () => throwError(
                        () => new TimeoutError($ts`Timed out after ${timeoutMs} ms waiting for reservation ${reservation.id}`)
                    )
                })
            );

            await firstValueFrom(withTimeout);
        });
    }

    private async runSingleFlight(key: string, fn: () => Promise<void>): Promise<void> {
        const existing: Promise<void> | undefined = this.inFlightReservationWaits.get(key);
        if (existing !== undefined) {
            return existing;
        }

        const promise: Promise<void> = (async () => {
            try {
                await fn();
            }
            finally {
                this.inFlightReservationWaits.delete(key);
                // this.metrics.inFlight.set({ cache: this.name }, this.inFlightReservationWaits.size);
            }
        })();

        this.inFlightReservationWaits.set(key, promise);
        // this.metrics.inFlight.set({ cache: this.name }, this.inFlightReservationWaits.size);
        return promise;
    }

    private async getReservationReadyAtMs(reservation: RateLimitReservation): Promise<number> {
        const state: TState | undefined = await this.config.store.get(reservation.key);
        if (!state) {
            return Infinity;
        }
        const record: RateLimitReservation | undefined = state.reservations.find(r => r.id === reservation.id);
        return record ? record.readyAtMs : Infinity;
    }

    /**
     * Given the current algorithm state and the ordered list of *pending*
     * reservations ahead of this one, compute the readyAtMs for a new
     * reservation of `count`. This is a pure, synchronous function because
     * it runs inside the store's atomic updater.
     */
    protected abstract computeReadyAtMs(
        state: TState,
        reservations: RateLimitReservation[],
        count: number,
        now: number
    ): number;
    protected abstract debitCapacity(state: TState, count: number): TState;
    protected abstract creditCapacity(state: TState, count: number): TState;
    protected abstract initialAlgoState(now: number): TState;
    protected abstract recomputeReadyTimes(state: TState, now: number): TState;

    abstract consume(key: string, count: number): Promise<RateLimitResult> | RateLimitResult;

    /**
     * Attempts the algorithm-specific reservation, given that the shared,
     * store-independent preconditions (`count <= capacity` and
     * `count <= maxReservationCount`) have already passed. Implementations
     * own the full lifecycle: computing `readyAtMs`, rejecting with
     * `QUEUE_TOO_LONG` if it would exceed `maxReservationWaitMs`, and
     * constructing the returned reservation's `getReadyAtMs`/`waitUntilReady`/
     * `commit`/`cancel` closures. Resolving those closures (including TTL
     * expiry) must call recordReservationClosed exactly once.
     * @param key - The key of the thing being rate limited, eg. A user id.
     * @param count - The amount of the limited resource to reserve.
     * @returns The outcome of the reservation attempt.
     */
    protected async doReserve(
        key: string,
        count: number
    ): Promise<RateLimitReservationResult> {
        try {
            let newReservation: RateLimitReservation | undefined;

            const id: string = UUIDUtilities.generate();

            await this.config.store.atomicUpdate(
                key,
                (current) => {
                    current ??= this.initialAlgoState(Date.now());
                    const now: number = Date.now(); // capture inside updater for consistency

                    // Compute where this reservation would land
                    const pending: RateLimitReservation[] = current.reservations.filter(r => r.expiresAtMs > now);
                    const readyAt: number = this.computeReadyAtMs(current, pending, count, now);

                    if (!this.isWithinReservationHorizon(readyAt, now)) {
                        throw new RateLimitReservationError(
                            RateLimitReservationRejectionReason.QUEUE_TOO_LONG,
                            readyAt - now
                        );
                    }

                    const additionalRejection: RateLimitReservationRejectionReason | undefined
                        = this.checkAdditionalReservationLimits(current, pending, count, now);
                    if (additionalRejection !== undefined) {
                        throw new RateLimitReservationError(additionalRejection, readyAt - now);
                    }

                    // Debit capacity immediately
                    current = this.debitCapacity(current, count);

                    newReservation = {
                        id,
                        key,
                        count,
                        readyAtMs: readyAt,
                        expiresAtMs: readyAt + this.resolveGracePeriodMs(readyAt - now)
                    };

                    return {
                        ...current,
                        reservations: [...current.reservations, newReservation],
                        expiresAtMs: Math.max(current.expiresAtMs, newReservation.expiresAtMs)
                    };
                }
            );

            assert(newReservation);

            return {
                allowed: true,
                reservation: newReservation
            };
        }
        catch (error) {
            if (error instanceof RateLimitReservationError) {
                return {
                    allowed: false,
                    reason: error.reason,
                    estimatedWaitMs: error.estimatedWaitMs
                };
            }
            throw error;
        }
    }

    private initMetrics(): RateLimiterMetrics {
        const labels: string[] = ['limiter'];
        const labelsWithOp: string[] = ['limiter', 'operation'];

        return {
            allowed: this.metricsService.getCounter('rate_limit_allowed_total', labels),
            blocked: this.metricsService.getCounter('rate_limit_blocked_total', labels),
            errors: this.metricsService.getCounter('rate_limit_errors_total', labelsWithOp),
            activeKeys: this.metricsService.getGauge('rate_limit_active_keys', labels),
            activeReservations: this.metricsService.getGauge('rate_limit_active_reservations', labels),
            decisionDuration: this.metricsService.getHistogram(
                'rate_limit_decision_duration_ms',
                labels,
                [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]
            ),
            storeDuration: this.metricsService.getHistogram(
                'rate_limit_store_duration_ms',
                labelsWithOp,
                [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100]
            ),
            remainingPercent: this.metricsService.getHistogram(
                'rate_limit_remaining_ratio',
                labels,
                [0, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1]
            ),
            retryAfterMs: this.metricsService.getHistogram(
                'rate_limit_retry_after_ms',
                labels,
                [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 300000]
            )
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrap<TArgs extends unknown[], V, TOptions extends RateLimitWrapOptions<TArgs> | undefined>(
        fn: (...args: TArgs) => V | Promise<V>,
        options?: TOptions
    ): (...args: TArgs) => RateLimitWrapResult<V, TOptions> {
        return (async (...args) => {
            const key: string = options?.keyFn ? await options.keyFn(...args) : defaultKey;
            const count: number = options?.countFn ? await options.countFn(...args) : 1;

            if (count === 0) {
                return await fn(...args);
            }

            let result: RateLimitResult;
            try {
                if (count < 0) {
                    throw new InternalError(`A count of less than 0 was received for rate limiter "${this.config.name}", key: "${key}"`);
                }
                const decisionStart: number = performance.now();
                result = await this.consume(key, count);
                this.metrics.remainingPercent.observe(
                    { limiter: this.config.name },
                    NumberUtilities.divide(result.remaining, result.limit).toNumber()
                );
                this.metrics.decisionDuration.observe(
                    { limiter: this.config.name },
                    performance.now() - decisionStart
                );
            }
            catch (error) {
                this.metrics.errors.increase({
                    limiter: this.config.name,
                    operation: 'consume'
                });
                throw error;
            }

            if (result.allowed) {
                this.metrics.allowed.increase({ limiter: this.config.name });
                return await fn(...args);
            }

            if (options?.reserveIfUnavailable === true) {
                const reservation: RateLimitReservationResult = await this.reserve(
                    key,
                    count
                );

                if (reservation.allowed) {
                    return reservation;
                }
            }

            this.metrics.blocked.increase({ limiter: this.config.name });
            this.metrics.retryAfterMs.observe(
                { limiter: this.config.name },
                Math.max(0, NumberUtilities.subtract(result.retryAtMs, Date.now()).toNumber())
            );

            throw new TooManyRequestsError(
                $ts`Rate limit was reached`,
                result
            );
        }) as (...args: TArgs) => RateLimitWrapResult<V, TOptions>;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reserve(key: string, count: number): Promise<RateLimitReservationResult> {
        // Structural check first: free (no store access), and this can never
        // succeed regardless of policy or timing, so it's excluded from
        // decisionDuration the same way count < 0 is excluded in wrap().
        if (count > this.config.capacity) {
            return {
                allowed: false,
                reason: RateLimitReservationRejectionReason.EXCEEDS_CAPACITY
            };
        }

        const decisionStart: number = performance.now();
        let result: RateLimitReservationResult;
        try {
            const maxReservationCount: number = await this.resolveMaxReservationCount(key);
            if (count > maxReservationCount) {
                return {
                    allowed: false,
                    reason: RateLimitReservationRejectionReason.EXCEEDS_RESERVATION_LIMIT
                };
            }
            result = await this.doReserve(key, count);
        }
        catch (error) {
            this.metrics.errors.increase({
                limiter: this.config.name,
                operation: 'reserve'
            });
            throw error;
        }
        finally {
            this.metrics.decisionDuration.observe(
                { limiter: this.config.name },
                performance.now() - decisionStart
            );
        }

        if (result.allowed) {
            this.metrics.activeReservations.increase({ limiter: this.config.name });
        }

        return result;
    }

    /**
     * Resolves the configured `maxReservationCount` for the given key,
     * defaulting to `capacity` (no policy limit beyond the structural one)
     * when unset.
     * @param key - The key of the thing being rate limited, eg. A user id.
     * @returns The maximum size a single reservation is allowed to have.
     */
    protected async resolveMaxReservationCount(key: string): Promise<number> {
        return typeof this.config.maxReservationCount === 'function'
            ? await this.config.maxReservationCount(key)
            : this.config.maxReservationCount;
    }

    /**
     * Checks whether a candidate ready time falls within the configured
     * `maxReservationWaitMs`. Pure and synchronous — safe to call from within
     * a store's atomic updater.
     * @param candidateReadyAtMs - The ready time a reservation attempt computed.
     * @param now - The current time (ms since epoch), as captured by the caller.
     * @returns Whether the candidate ready time is within the allowed wait.
     */
    protected isWithinReservationHorizon(candidateReadyAtMs: number, now: number): boolean {
        if (!Number.isFinite(candidateReadyAtMs)) {
            return false;
        }
        return this.config.maxReservationWaitMs === undefined || candidateReadyAtMs - now <= this.config.maxReservationWaitMs;
    }

    /**
     * Hook for algorithm-specific reservation limits beyond the shared
     * `maxReservationWaitMs` horizon check. Eg. Bounding how many
     * reservations may be queued for a key regardless of estimated wait
     * time. Pure and synchronous — safe to call from within a store's
     * atomic updater. No-op by default.
     * @param _state - The current algorithm state.
     * @param _pending - The unexpired reservations already queued for this key.
     * @param _count - The amount being reserved.
     * @param _now - The current time (ms since epoch), as captured by the caller.
     * @returns A rejection reason if the reservation should be refused, otherwise `undefined`.
     */
    protected checkAdditionalReservationLimits(
        // eslint-disable-next-line unusedImports/no-unused-vars
        _state: TState,
        // eslint-disable-next-line unusedImports/no-unused-vars
        _pending: RateLimitReservation[],
        // eslint-disable-next-line unusedImports/no-unused-vars
        _count: number,
        // eslint-disable-next-line unusedImports/no-unused-vars
        _now: number
    ): RateLimitReservationRejectionReason | undefined {
        return undefined;
    }

    /**
     * Resolves the grace period to add on top of a reservation's `readyAtMs`
     * to determine its `expiresAtMs`.
     * @param waitMs - The reservation's own expected wait time (`readyAtMs - now`).
     * @returns The grace period, in ms.
     */
    protected resolveGracePeriodMs(waitMs: number): number {
        return typeof this.config.reservationGracePeriodMs === 'function'
            ? this.config.reservationGracePeriodMs(waitMs)
            : this.config.reservationGracePeriodMs;
    }

    /**
     * Must be called by a reservation's `commit()`/`cancel()` closures
     * (exactly once each), and by TTL-based auto-expiry, whenever an open
     * reservation is resolved.
     */
    protected recordReservationClosed(): void {
        this.metrics.activeReservations.decrease({ limiter: this.config.name });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cleanup(): Promise<void> {
        await this.measureStoreOperation('cleanup', async () => {
            const keys: string[] = await this.config.store.keys();

            await Promise.all(keys.map(async key => {

                const state: TState | undefined = await this.config.store.get(key);
                // Key is already expired or missing – just remove it
                if (!state || state.expiresAtMs <= Date.now()) {
                    await this.config.store.delete(key);
                    return;
                }

                try {
                    await this.config.store.atomicUpdate(key, (current) => {
                        if (!current) {
                            throw new InternalError(`Data with key "${key}" could not be found`);
                        }
                        const now: number = Date.now();
                        let changed: boolean = false;
                        for (const r of current.reservations) {
                            if (r.expiresAtMs <= now) {
                                // Refund capacity
                                current = this.creditCapacity(current, r.count);
                                changed = true;
                            }
                        }
                        if (changed) {
                            current.reservations = current.reservations.filter(r => r.expiresAtMs > now);
                            current = this.recomputeReadyTimes(current, now); // must return new state
                        }
                        return current;
                    });
                }
                catch {
                    // nothing to cleanup
                }

            }));
        });
        void this.updateActiveKeysGauge();
        void this.updateActiveReservationsGauge();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getReservation(id: string, key: string = defaultKey): Promise<RateLimitReservation | undefined> {
        const state: TState | undefined = await this.config.store.get(key);
        if (!state) {
            return undefined;
        }
        return state.reservations.find(r => r.id === id);
    }

    /**
     * Updates the active reservations gauge metric.
     */
    protected async updateActiveReservationsGauge(): Promise<void> {
        try {
            const keys: string[] = await this.config.store.keys();
            const now: number = Date.now();
            let total: number = 0;
            for (const key of keys) {
                const state: TState | undefined = await this.config.store.get(key);
                if (state && state.expiresAtMs > now) {
                    total += state.reservations.filter(r => r.expiresAtMs > now).length;
                }
            }
            this.metrics.activeReservations.set({ limiter: this.config.name }, total);
        }
        catch {
            // not critical
        }
    }

    /**
     * Updates the active keys gauge metric.
     */
    protected async updateActiveKeysGauge(): Promise<void> {
        try {
            this.metrics.activeKeys.set(
                { limiter: this.config.name },
                await this.config.store.size()
            );
        }
        catch {
            // not critical — never surface gauge update failures
        }
    }

    /**
     * Measures the given store operation (performance & errors).
     * @param operation - Name of the operation to measure.
     * @param fn - The actual operation.
     * @returns The result of the operation measured.
     */
    protected async measureStoreOperation<T>(
        operation: string,
        fn: () => T
    ): Promise<T> {
        const start: number = performance.now();

        try {
            return await fn();
        }
        catch (error) {
            this.metrics.errors.increase({
                limiter: this.config.name,
                operation
            });
            throw error;
        }
        finally {
            this.metrics.storeDuration.observe(
                {
                    limiter: this.config.name,
                    operation
                },
                performance.now() - start
            );
        }
    }
}