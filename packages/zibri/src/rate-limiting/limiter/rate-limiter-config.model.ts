import { BaseRateLimitState, RateLimiterStoreInterface } from '../stores/rate-limiter-store.interface';

/**
 * Configuration for the rate limiter.
 */
export type RateLimiterConfig<TState extends BaseRateLimitState> = {
    /**
     * The unique name of the rate limiter.
     */
    readonly name: string,
    /**
     * The maximum amount of the limited resource obtainable at once, e.g. The
     * bucket size or per-window limit. Used to reject reservations that could
     * never be satisfied, no matter how long the caller is willing to wait.
     */
    readonly capacity: number,
    /**
     * The backing store for this limiter's state.
     * Exposed so consumers can access it for administrative operations (e.g.
     * Resetting the limits of a specific user).
     */
    readonly store: RateLimiterStoreInterface<TState>,
    /**
     * The maximum size of a single reservation for a given key. Defaults
     * to `capacity` (i.e. No policy limit beyond the structural one) when
     * left unset. Useful for preventing one caller from reserving most or
     * all of a shared key's capacity at once.
     */
    readonly maxReservationCount: number | ((key: string) => number | Promise<number>),
    /**
     * The maximum amount of time (ms) a new reservation is allowed to
     * wait before becoming ready. A reservation that would exceed this is
     * rejected with `QUEUE_TOO_LONG` instead of being queued
     * indefinitely. Left unset, there is no cap.
     */
    readonly maxReservationWaitMs: number | undefined,
    /**
     * How much additional time (ms), beyond a reservation's `readyAtMs`,
     * to wait before treating it as abandoned and auto-cancelling it.
     * Given as a function of the reservation's own expected wait time so
     * the grace period scales with how long the reservation was already
     * going to take. Defaults to whichever is larger: 5 seconds, or the
     * reservation's own wait time.
     */
    readonly reservationGracePeriodMs: number | ((waitMs: number) => number)
};

/**
 * Configuration input for the rate limiter.
 */
export type RateLimiterConfigInput<TState extends BaseRateLimitState> = Partial<RateLimiterConfig<TState>>
    & Pick<RateLimiterConfig<TState>, 'name' | 'capacity' | 'store' | 'maxReservationWaitMs'>;