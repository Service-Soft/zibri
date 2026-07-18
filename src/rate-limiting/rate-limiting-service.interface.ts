import { RateLimiterInterface } from './limiter/rate-limiter.interface';
import { BaseRateLimitState } from './stores/rate-limiter-store.interface';

/**
 * Definition of a rate limiting service.
 */
export interface RateLimitingServiceInterface {
    /**
     * All limiters that are being used.
     */
    readonly limiters: RateLimiterInterface<BaseRateLimitState>[],
    /**
     * Cleans up state data.
     */
    cleanup: () => void | Promise<void>
}