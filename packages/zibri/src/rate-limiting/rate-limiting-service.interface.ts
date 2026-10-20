import { RateLimiterInterface } from './limiter/rate-limiter.interface.ts';
import { BaseRateLimitState } from './stores/rate-limiter-store.interface.ts';

/**
 * Definition of a rate limiting service.
 */
export interface RateLimitingServiceInterface {
    /**
     * All limiters that are being used.
     */
    readonly limiters: RateLimiterInterface<BaseRateLimitState>[],
    /**
     * Adds a limiter that is built while the application starts, by the feature that uses it, so its
     * state is cleaned up with the others. Adding the same limiter again does nothing.
     * @throws When another limiter has the same name.
     */
    // any for the reason the limiter tokens use it: the state is in both a parameter and a return
    // position of the store, so a limiter of any concrete state is assignable to nothing narrower
    // eslint-disable-next-line typescript/no-explicit-any
    addLimiter: (limiter: RateLimiterInterface<any>) => void,
    /**
     * Cleans up state data.
     */
    cleanup: () => void | Promise<void>
}