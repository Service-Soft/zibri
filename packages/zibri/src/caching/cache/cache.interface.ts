import { type CacheTagMatcher } from '../cache-tag-matchers';
import { CacheKeyProvider, CacheSetDirectOptions, CacheWrapDeleteOptions, CacheWrapInvalidateOptions, CacheWrapOptions, CacheWrapWriteOptionsArgsOnly, CacheWrapWriteOptionsWithResult, OnInvalidationFailure, ResultCacheKeyProvider } from './cache-options.model';
import { MultiTierCache } from './multi-tier.cache';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { type CacheStoreInterface } from '../store/cache-store.interface';

/**
 * Definition for a cache.
 */
export interface CacheInterface<K, V, CacheTag extends string, WriteResultAvailable extends boolean, N extends string> {
    /**
     * Phantom carrier, only for type inference.
     */
    readonly _writeResultAvailable: WriteResultAvailable,
    /**
     * The name of the cache. Should be unique.
     */
    readonly name: N,
    /**
     * The tags that any values inside of this cache might have.
     *
     * This is used for performance improvements, to skip caches for invalidateTags if the given tag will never be inside any of the cached values.
     * Can be set to 'all' to check every time.
     */
    readonly tags: 'all' | readonly CacheTagMatcher[],
    /**
     * The default time to live for a cached value.
     */
    readonly defaultTtl?: number | (() => number | Promise<number>),
    /**
     * Whether to throw when invalidation fails or to just log and ignore.
     */
    readonly onInvalidationFailure?: OnInvalidationFailure,
    /**
     * The store used by this cache.
     */
    readonly store: CacheStoreInterface<K, V>,

    /**
     * Returns a cached value if present; otherwise calls fn.
     * The exact caching behavior (whether the result is stored) depends on the concrete strategy.
     */
    wrap: <TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapOptions<V, TArgs, CacheTag>
    ) => (...args: TArgs) => Promise<V>,

    /**
     * Returns a wrapped version of fn that writes its result into the cache.
     * Key is derived from the *result*, not the args — handles the
     * create-with-generated-id case cleanly.
     */
    wrapWrite: <TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: WriteResultAvailable extends true
            ? ResultCacheKeyProvider<K, V, TArgs>
            : CacheKeyProvider<K, TArgs>,
        options?: WriteResultAvailable extends true
            ? CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
            : CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
    ) => (...args: TArgs) => Promise<V>,

    /**
     * Returns a wrapped version of fn that invalidates a cache entry after call.
     */
    wrapDelete: <TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapDeleteOptions<TArgs, CacheTag>
    ) => (...args: TArgs) => Promise<TReturn>,

    /**
     * Calls fn → Invalidates tags → Returns the fn result.
     * For operations that affect cached data but produce no cacheable result,
     * e.g. CreateAll/updateAll on a collection cache where no filter key
     * can be derived from the output.
     */
    wrapInvalidate: <TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        options: CacheWrapInvalidateOptions<TArgs, CacheTag> // required — this method exists solely to invalidate
    ) => (...args: TArgs) => Promise<TReturn>,
    /**
     * Directly write a value into this cache, following its configured
     * write strategy.
     *
     * Use this instead of `wrapWrite` when the source function has already
     * been called and you only need to propagate the result.
     */
    setDirect: (key: K, value: V, options?: CacheSetDirectOptions<CacheTag>) => Promise<void>
}

/**
 * The type for any unspecified cache.
 */
// eslint-disable-next-line typescript/no-explicit-any, stylistic/max-len
export type AnyCache = MultiTierCache<any, any, any> | CacheInterface<any, any, string, true, string> | CacheInterface<any, any, string, false, string>;

/**
 * Checks whether or not the given value is a cache.
 * @param value - The value to check.
 * @returns True if the value has all the keys of a cache, false otherwise.
 */
export function isCache(value: unknown): value is AnyCache {

    if (value instanceof MultiTierCache) {
        return true;
    }
    // eslint-disable-next-line typescript/no-explicit-any
    const keys: (keyof ExcludeStrict<AnyCache, MultiTierCache<any, any, any>>)[] = [
        'defaultTtl',
        'name',
        'onInvalidationFailure',
        'store',
        'tags',
        'wrap',
        'wrapDelete',
        'wrapInvalidate',
        'wrapWrite'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}