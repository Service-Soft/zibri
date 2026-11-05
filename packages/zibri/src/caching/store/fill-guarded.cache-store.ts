import { CacheStoreConfig, CacheStoreInterface } from './cache-store.interface';
import { CachedValue } from './cached-value.model';
import { cacheKeyOf } from '../cache-key.function';

/**
 * A fill of a cache in progress: the value the source answers is cached only while nothing written
 * since the fill started could have changed it.
 */
export type CacheFill = {
    /**
     * Whether the key was written, deleted or invalidated since the fill started.
     */
    stale: boolean
};

/**
 * The store a cache works with: its own store, which also tells a fill whether a write overtook it.
 *
 * A fill reads the source and caches the answer. A write that lands while the read is under way
 * changes the source after the read took its value, so caching that value afterwards serves what the
 * write replaced until the entry expires.
 */
export class FillGuardedCacheStore<K, V> implements CacheStoreInterface<K, V> {
    /**
     * The fills in progress, by the key they fill.
     */
    private readonly fills: Map<string, Set<CacheFill>> = new Map();

    constructor(private readonly store: CacheStoreInterface<K, V>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get config(): CacheStoreConfig {
        return this.store.config;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get(key: K): CachedValue<V> | undefined | Promise<CachedValue<V> | undefined> {
        return this.store.get(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    set(key: K, value: CachedValue<V>): void | Promise<void> {
        this.markStale(key);
        return this.store.set(key, value);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    delete(key: K): void | Promise<void> {
        this.markStale(key);
        return this.store.delete(key);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    clear(): void | Promise<void> {
        this.markEveryFillStale();
        return this.store.clear();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    invalidateTags(tags: string[]): void | Promise<void> {
        // the tags a fill caches under are known once the source answered, so every fill counts
        this.markEveryFillStale();
        return this.store.invalidateTags(tags);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    size(): number | Promise<number> {
        return this.store.size();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    removeExpired(): number | Promise<number> {
        return this.store.removeExpired();
    }

    /**
     * Starts a fill of a key. End it with {@link endFill}, whatever happens.
     * @param key - The key.
     * @returns The fill.
     */
    beginFill(key: K): CacheFill {
        const fill: CacheFill = { stale: false };
        const id: string = cacheKeyOf(key);
        this.fills.set(id, (this.fills.get(id) ?? new Set<CacheFill>()).add(fill));
        return fill;
    }

    /**
     * Ends a fill.
     * @param key - The key it filled.
     * @param fill - The fill.
     */
    endFill(key: K, fill: CacheFill): void {
        const id: string = cacheKeyOf(key);
        const fills: Set<CacheFill> | undefined = this.fills.get(id);
        fills?.delete(fill);
        if (fills?.size === 0) {
            this.fills.delete(id);
        }
    }

    private markStale(key: K): void {
        for (const fill of this.fills.get(cacheKeyOf(key)) ?? []) {
            fill.stale = true;
        }
    }

    private markEveryFillStale(): void {
        for (const fills of this.fills.values()) {
            for (const fill of fills) {
                fill.stale = true;
            }
        }
    }
}