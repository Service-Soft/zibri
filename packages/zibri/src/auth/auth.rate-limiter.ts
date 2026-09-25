import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { RateLimiter } from '../rate-limiting/decorators/rate-limiter.decorator';
import { TokenBucketRateLimiter, TokenBucketState } from '../rate-limiting/limiter/token-bucket.rate-limiter';
import { InMemoryRateLimiterStore } from '../rate-limiting/stores/in-memory.rate-limiter-store';

/**
 * How much of the framework's own auth endpoints one caller may use.
 */
export type AuthRateLimitOptions = {
    /**
     * How many attempts a caller may make before being refused.
     *
     * Spent across all of the guarded endpoints together, which is what makes it a budget for
     * "trying to get in" rather than for one route.
     */
    maxAttempts: number,
    /**
     * How long a caller takes to earn its attempts back, in milliseconds.
     */
    windowInMs: number
};

/**
 * What limits the framework's own auth endpoints.
 *
 * Per caller, so one attacker cannot lock everybody else out. The numbers are a trade between a user
 * who mistypes a password and an attacker guessing one: twenty attempts per ten minutes leaves a
 * person room to fumble their way in and leaves an attacker a couple of guesses a minute, from each
 * address they can send from.
 *
 * **Its store is in memory, so the limit is per instance.** Three replicas allow three times as much
 * as this says, which is the honest default: a shared store means a round trip on the login path and
 * a data source that must be up for anyone to log in. A deployment that would rather have an exact
 * limit replaces this limiter through {@link ZIBRI_DI_TOKENS.AUTH_RATE_LIMITER} with one built on
 * `RepositoryRateLimiterStore`.
 */
@RateLimiter({ register: 'onUse' })
export class AuthRateLimiter extends TokenBucketRateLimiter {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUTH_RATE_LIMIT_OPTIONS)
        options: AuthRateLimitOptions
    ) {
        super(
            options.windowInMs,
            {
                name: 'AuthRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>(),
                capacity: options.maxAttempts,
                maxReservationWaitMs: undefined
            }
        );
    }
}