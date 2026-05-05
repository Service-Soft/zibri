/**
 * Provider for a time to live value.
 */
export type CacheTtlProvider<TArgs extends unknown[]> = number | ((...args: TArgs) => number | undefined);

/**
 * Provider for a time to live value where the result of the original function is available.
 */
export type ResultCacheTtlProvider<TResult, TArgs extends unknown[]> = number | ((result: TResult, ...args: TArgs) => number | undefined);

/**
 * Tags derived from args only (no result available) — wrapDelete, wrapInvalidate.
 */
export type CacheTagsProvider<TArgs extends unknown[], CacheTag extends string> = CacheTag[] | ((...args: TArgs) => CacheTag[]);

/**
 * Tags derived from result + args — wrap, wrapWrite.
 */
export type ResultCacheTagsProvider<TResult, TArgs extends unknown[], CacheTag extends string> = CacheTag[]
    | ((result: TResult, ...args: TArgs) => CacheTag[]);

/**
 * Provider for a cache key.
 */
export type CacheKeyProvider<K, TArgs extends unknown[]> = (...args: TArgs) => K;

/**
 * Provider for a cache key where the result of the original function is available.
 */
export type ResultCacheKeyProvider<K, TResult, TArgs extends unknown[]> = (result: TResult, ...args: TArgs) => K;

/**
 * The options on how to handle invalidation failures.
 */
export type OnInvalidationFailure = 'bestEffort' | 'throw';

/**
 * Options for the wrap method of a cache.
 */
export type CacheWrapOptions<V, TArgs extends unknown[], CacheTag extends string> = {
    /**
     * A provider for the time to live value.
     */
    ttl?: ResultCacheTtlProvider<V, TArgs>,
    /**
     * A provider for the tags to set.
     */
    tags?: ResultCacheTagsProvider<V, TArgs, CacheTag>
};

/**
 * Options for the wrapWrite method of a cache when the result of the original function is available.
 */
export type CacheWrapWriteOptionsWithResult<V, TArgs extends unknown[], CacheTag extends string> = {
    /**
     * A provider for the time to live value.
     */
    ttl?: ResultCacheTtlProvider<V, TArgs>,
    /**
     * A provider for the tags to set.
     */
    tags?: ResultCacheTagsProvider<V, TArgs, CacheTag>,
    /**
     * A provider for the tags to invalidate.
     */
    invalidatesTags?: ResultCacheTagsProvider<V, TArgs, CacheTag>
};

/**
 * Options for the wrapWrite method of a cache when the result of the original function is NOT available.
 */
export type CacheWrapWriteOptionsArgsOnly<TArgs extends unknown[], CacheTag extends string> = {
    /**
     * A provider for the time to live value.
     */
    ttl?: CacheTtlProvider<TArgs>,
    /**
     * A provider for the tags to set.
     */
    tags?: CacheTagsProvider<TArgs, CacheTag>,
    /**
     * A provider for the tags to invalidate.
     */
    invalidatesTags?: CacheTagsProvider<TArgs, CacheTag>
};

/**
 * Options for the wrapDelete method of a cache.
 */
export type CacheWrapDeleteOptions<TArgs extends unknown[], CacheTag extends string> = {
    /**
     * A provider for the tags to invalidate.
     */
    invalidatesTags?: CacheTagsProvider<TArgs, CacheTag>
};

/**
 * Options for the wrapInvalidate method of a cache.
 */
export type CacheWrapInvalidateOptions<TArgs extends unknown[], CacheTag extends string> = {
    /**
     * A provider for the tags to invalidate.
     */
    invalidatesTags: CacheTagsProvider<TArgs, CacheTag>
};