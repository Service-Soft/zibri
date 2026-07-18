import { SuccessRateLimitReservationResult } from './reservation/rate-limit-reservation-result.model';

/**
 * Provider for a rate limit key.
 */
export type RateLimitKeyProvider<TArgs extends unknown[]> = (...args: TArgs) => string | Promise<string>;

/**
 * Provider for a rate limit count.
 */
export type RateLimitCountProvider<TArgs extends unknown[]> = (...args: TArgs) => number | Promise<number>;

/**
 * Options for the rate limiter wrap method.
 */
export type RateLimitWrapOptions<TArgs extends unknown[]> = {
    /**
     * Defines how a key is resolved, if the rate limit eg. Depends on a user.
     */
    keyFn?: RateLimitKeyProvider<TArgs>,
    /**
     * Defines how many tokens the operation uses, if its eg. A batch endpoint.
     */
    countFn?: RateLimitCountProvider<TArgs>,
    /**
     * Whether or not a reservation should be made if the limit would be reached instead of throwing a TooManyRequestsError.
     */
    reserveIfUnavailable?: boolean
};

/**
 * Result of the function returned by the rate limiter wrap method.
 */
// eslint-disable-next-line jsdoc/require-jsdoc
export type RateLimitWrapResult<V, TOptions> = TOptions extends { reserveIfUnavailable: true }
    ? Promise<V | SuccessRateLimitReservationResult>
    : Promise<V>;