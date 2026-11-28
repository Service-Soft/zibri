import { Inject } from '../../di/decorators/inject.decorator';
import { RateLimiter } from '../../rate-limiting/decorators/rate-limiter.decorator';
import { TokenBucketRateLimiter, TokenBucketState } from '../../rate-limiting/limiter/token-bucket.rate-limiter';
import { InMemoryRateLimiterStore } from '../../rate-limiting/stores/in-memory.rate-limiter-store';
import { ZIBRI_MCP_PLUGIN_DI_TOKENS } from './mcp.tokens';
import { type McpPluginOptions } from './models/mcp-plugin-options.model';

/**
 * What limits the requests of each service account to the MCP endpoint, as `rateLimit` of the plugin options says.
 *
 * Its store is in memory, so the limit is per instance, as the one of `AuthRateLimiter` is. Replaceable through
 * `ZIBRI_MCP_PLUGIN_DI_TOKENS.RATE_LIMITER`, such as by one built on `RepositoryRateLimiterStore`.
 */
@RateLimiter({ register: 'onUse' })
export class McpRateLimiter extends TokenBucketRateLimiter {
    constructor(
        @Inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.OPTIONS)
        options: McpPluginOptions
    ) {
        super(
            options.rateLimit.windowInMs,
            {
                name: 'McpRateLimiter',
                store: new InMemoryRateLimiterStore<TokenBucketState>({ maxKeys: options.rateLimit.maxKeys ?? 10_000 }),
                capacity: options.rateLimit.maxRequests,
                maxReservationWaitInMs: undefined,
                onStoreFailure: options.rateLimit.onStoreFailure
            }
        );
    }
}
