import { BaseRateLimiter } from './base-rate-limiter.model';
import { RateLimitResult } from '../rate-limit-result.model';
import { RateLimitWrapOptions, RateLimitWrapResult } from '../rate-limit-wrap-options.model';
import { RateLimiterConfig } from './rate-limiter-config.model';
import { RateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { RateLimitReservation } from '../reservation/rate-limit-reservation.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * Definition for a rate limiter.
 */
export interface RateLimiterInterface<TState extends BaseRateLimitState> {
    /**
     * Configuration of the rate limiter.
     */
    readonly config: RateLimiterConfig<TState>,
    /**
     * Checks whether or not the provided count of the limited resource is currently available or if it has been used up.
     * If it's available, it consumes it. If not, it returns a denied result.
     * @param key - The key of the thing being rate limited, eg. A user id.
     * @param count - The amount of the limited resource to consume.
     * @returns The outcome and current limiter state.
     */
    consume: (key: string, count: number) => Promise<RateLimitResult> | RateLimitResult,
    /**
     * Reserves the provided count of the limited resource, even if it isn't
     * available yet. Unlike consume, this immediately debits the
     * capacity and reports when it will actually become available,
     * guaranteeing the reservation's place in line ahead of anything
     * requested afterward.
     *
     * Exactly one of the returned reservation's `commit()` or `cancel()` methods must
     * eventually be called. Automatically cancels after a timeout.
     * @param key - The key of the thing being rate limited, eg. A user id.
     * @param count - The amount of the limited resource to reserve.
     * @returns The outcome of the reservation attempt.
     */
    reserve: (key: string, count: number) => Promise<RateLimitReservationResult> | RateLimitReservationResult,
    /**
     * Returns the current reservation record for the given key and id,
     * or `undefined` if it no longer exists. The returned object reflects
     * the latest readyAtMs.
     */
    getReservation: (id: string, key?: string) => (RateLimitReservation | undefined) | Promise<RateLimitReservation | undefined>,
    /**
     * Waits for the given reservation to be available.
     */
    waitForReservation: (reservation: RateLimitReservation, timeoutMs: number) => void | Promise<void>,
    /**
     * Commits the reservation with the given id and key.
     */
    commitReservation: (reservation: RateLimitReservation) => void | Promise<void>,
    /**
     * Cancels the reservation with the given id and key.
     */
    cancelReservation: (reservation: RateLimitReservation) => void | Promise<void>,
    /**
     * Wraps the given function to use rate limiting. Is mainly used by the \@RateLimited decorator.
     */
    wrap: <TArgs extends unknown[], V, TOptions extends RateLimitWrapOptions<TArgs> | undefined>(
        fn: (...args: TArgs) => V | Promise<V>,
        options?: TOptions
    ) => (...args: TArgs) => RateLimitWrapResult<V, TOptions>,

    /**
     * Should cleanup the state of the store to free up memory.
     */
    cleanup: () => void | Promise<void>
}

// eslint-disable-next-line jsdoc/require-jsdoc
export function isRateLimiter(value: unknown): value is RateLimiterInterface<BaseRateLimitState> {
    if (value instanceof BaseRateLimiter) {
        return true;
    }

    const keys: (keyof RateLimiterInterface<BaseRateLimitState>)[] = [
        'config',
        'consume',
        'reserve',
        'commitReservation',
        'cancelReservation',
        'wrap',
        'cleanup',
        'getReservation'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}