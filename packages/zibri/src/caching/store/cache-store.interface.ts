import { CachedValue } from './cached-value.model';

/**
 * The different strategies on how to handle cache overflows.
 */
export type RemoveOnOverflowStrategy = 'leastRecentlyUsed' | 'mostRecentlyUsed' | 'leastFrequentlyUsed' | 'firstInFirstOut';

/**
 * Configuration of a cache store.
 */
export type CacheStoreConfig = {
    /**
     * The maximum amount of entries that the store can hold.
     */
    readonly maxEntries: number,
    /**
     * The maximum amount of bytes that this store can hold.
     * Checks are done usually done using estimations, not exact numbers.
     */
    readonly maxBytes: number,
    /**
     * How to handle caches that exceed their maxEntries or maxBytes.
     */
    readonly removeOnOverflow: RemoveOnOverflowStrategy
};

/**
 * Interface for an cache store.
 */
export interface CacheStoreInterface<K, V> {
    /**
     * The configuration for the store.
     */
    readonly config: CacheStoreConfig,
    /**
     * Gets the cached value stored under the given key.
     */
    get: (key: K) => CachedValue<V> | undefined | Promise<CachedValue<V> | undefined>,
    /**
     * Stores a new cached value under the given key.
     */
    set: (key: K, value: CachedValue<V>) => void | Promise<void>,
    /**
     * Deletes the cached value stored under the given key.
     */
    delete: (key: K) => void | Promise<void>,
    /**
     * Completely clears all values from the cache.
     */
    clear: () => void | Promise<void>,
    /**
     * Invalidates all cached values that have one of the given tags.
     */
    invalidateTags: (tags: string[]) => void | Promise<void>,
    /**
     * The number of elements in the store.
     */
    size: () => number | Promise<number>
}