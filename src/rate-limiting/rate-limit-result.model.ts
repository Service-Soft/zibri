/**
 * Result for a rate limit that has been exceeded.
 */
export type FailedRateLimitResult = {
    /**
     * Whether the request is permitted.
     */
    allowed: false,
    /**
     * The configured maximum capacity of this limiter.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Limit | X-RateLimit-Limit} header.
     */
    limit: number,
    /**
     * Remaining capacity after this operation.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Remaining | X-RateLimit-Remaining} header.
     */
    remaining: number,
    /**
     * Timestamp at which capacity will reset.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Reset | X-RateLimit-Reset} header.
     */
    resetsAtMs: number,
    /**
     * Timestamp at which the caller may retry.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Retry-After | Retry-After} header.
     */
    retryAtMs: number
};

/**
 * Result for a rate limit that was successfully kept.
 */
export type SuccessRateLimitResult = {
    /**
     * Whether the request is permitted.
     */
    allowed: true,
    /**
     * The configured maximum capacity of this limiter.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Limit | X-RateLimit-Limit} header.
     */
    limit: number,
    /**
     * Remaining capacity after this operation.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Remaining | X-RateLimit-Remaining} header.
     */
    remaining: number,
    /**
     * Timestamp at which capacity will reset.
     * Maps to the {@link https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-RateLimit-Reset | X-RateLimit-Reset} header.
     */
    resetsAtMs: number
};

/**
 * The outcome of a RateLimiterInterface.consume call.
 * Carries enough information to populate standard rate-limit HTTP headers.
 */
export type RateLimitResult = SuccessRateLimitResult | FailedRateLimitResult;