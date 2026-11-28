import { RateLimiter } from '../../rate-limiting/decorators/rate-limiter.decorator';
import { TokenBucketRateLimiter, TokenBucketState } from '../../rate-limiting/limiter/token-bucket.rate-limiter';
import { InMemoryRateLimiterStore } from '../../rate-limiting/stores/in-memory.rate-limiter-store';
import { Ms } from '../../utilities/ms';

/**
 * What limits the page views and events one caller sends: 60 a minute per client address, together.
 *
 * Its store is in memory, so the limit is per instance. Replace it through
 * `ZIBRI_ANALYTICS_PLUGIN_DI_TOKENS.RATE_LIMITER`, such as with one built on `RepositoryRateLimiterStore`.
 */
// a visitor sends one page view per page and an event per click, so a minute of browsing stays far below this, and
// an office behind one address has room for its people. What it stops is somebody filling the tables with a loop
@RateLimiter({ register: 'onUse' })
export class AnalyticsRateLimiter extends TokenBucketRateLimiter {
    constructor() {
        super(
            Ms.MINUTE,
            {
                name: 'AnalyticsRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>(),
                capacity: 60,
                maxReservationWaitInMs: undefined
            }
        );
    }
}