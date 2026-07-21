import { CacheInterface } from '../cache/cache.interface';
import { MultiTierCache } from '../cache/multi-tier.cache';

/**
 * Extracts the key type `K` from a cache-like type.
 */
export type ExtractCacheKey<C>
    // eslint-disable-next-line typescript/no-explicit-any
    = C extends MultiTierCache<infer K, any, any, any>
        ? K
        // eslint-disable-next-line typescript/no-explicit-any
        : C extends CacheInterface<infer K, any, any, any, any>
            ? K
            : never;

/** Extract the WriteResultAvailable flag from a cache-like type. */
// eslint-disable-next-line jsdoc/require-jsdoc
export type ExtractCacheWriteResultAvailable<C> = C extends { _writeResultAvailable: infer WR }
    ? (WR extends boolean ? WR : never)
    : never;