import { type RateLimitStoreFailurePolicy } from '../../../rate-limiting/limiter/rate-limiter-config.model';

/**
 * How often one service account may call the MCP endpoint.
 */
export type McpRateLimitOptions = {
    /**
     * How many requests a service account may send before being refused with a `429`.
     */
    readonly maxRequests: number,
    /**
     * How long a service account takes to earn its requests back, in milliseconds.
     */
    readonly windowInMs: number,
    /**
     * What a service account the limiter has no room for gets: let through, or refused with a `503`.
     */
    readonly onStoreFailure: RateLimitStoreFailurePolicy,
    /**
     * How many service accounts the limiter keeps counts for at once. 10 000 by default.
     */
    readonly maxKeys?: number
};
