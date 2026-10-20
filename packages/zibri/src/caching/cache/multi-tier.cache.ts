
import { CacheOperation } from './cache-operation.enum.ts';
import { CacheWrapOptions, CacheWrapWriteOptionsWithResult, CacheWrapWriteOptionsArgsOnly, CacheWrapDeleteOptions, CacheWrapInvalidateOptions, CacheKeyProvider, ResultCacheKeyProvider, OnInvalidationFailure, CacheTagsProvider, CacheSetDirectOptions } from './cache-options.model.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { CacheContext } from '../../context/cache/cache.context.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { LoggerInterface } from '../../logging/logger.interface.ts';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface.ts';
import { CacheMetrics } from '../cache-metrics.model.ts';
import { CacheServiceInterface } from '../cache-service.interface.ts';
import { CacheSingleFlight } from '../cache-single-flight.model.ts';
import { type CacheTagMatcher } from '../cache-tag-matchers.ts';
import { ExtractCacheWriteResultAvailable } from '../decorators/decorator-types.ts';
import { CacheStoreInterface } from '../store/cache-store.interface.ts';
import { CachedValue } from '../store/cached-value.model.ts';

// eslint-disable-next-line jsdoc-js/require-jsdoc
type TierLike<K, V, CacheTag extends string, N extends string> = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly name: N,
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    store: CacheStoreInterface<K, V>,
    /**
     * The tags values in this tier might carry. Needed so that the multi tier cache can report the
     * tags of everything it holds, which is how the cache service decides whether to invalidate it.
     */
    readonly tags: 'all' | readonly CacheTagMatcher[],
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    _writeResultAvailable?: boolean,
    // eslint-disable-next-line typescript/method-signature-style
    setDirect(key: K, value: V, options?: CacheSetDirectOptions<CacheTag>): Promise<void>
};

// eslint-disable-next-line typescript/no-explicit-any, jsdoc-js/require-jsdoc
type TierName<Tiers extends readonly TierLike<any, any, any, any>[]> = Tiers[number]['name'];

/** Outer WR, true if any tier is true, else false. */
// eslint-disable-next-line typescript/no-explicit-any
type OuterWR<Tiers extends readonly TierLike<any, any, any, any>[]> = true extends ExtractCacheWriteResultAvailable<Tiers[number]>
    ? true
    : false;

/** The options object for wrapWrite. */
export type MultiWrapWriteOptions<
    V,
    TArgs extends unknown[],
    CacheTag extends string,
    // eslint-disable-next-line typescript/no-explicit-any
    Tiers extends readonly TierLike<any, V, CacheTag, any>[]
> = {
    /**
     * The configuration for each internal cache.
     */
    perCache?: Partial<Record<TierName<Tiers>, CacheWrapOptions<V, TArgs, CacheTag>>>,
    /**
     * A provider for the tags to invalidate.
     */
    invalidatesTags?: CacheTagsProvider<TArgs, CacheTag>
};

/** Per‑tier wrap options as an record of TierName and config. */
export type MultiWrapOptions<
    V,
    TArgs extends unknown[],
    CacheTag extends string,
    // eslint-disable-next-line typescript/no-explicit-any
    Tiers extends readonly TierLike<any, V, CacheTag, any>[]
> = Partial<Record<TierName<Tiers>, CacheWrapOptions<V, TArgs, CacheTag>>>;

/**
 * Multi‑tier cache that composes multiple {@link CacheInterface} instances.
 *
 * Reads are cascaded through the tiers (fastest first). When a lower tier
 * hits, all faster tiers are back‑filled. Writes are propagated to **every**
 * tier via their setDirect method.
 *
 * The `WriteResultAvailable` flag must be supplied explicitly. If you want
 * to mix a `false` tier (e.g. Write‑Around) into a `true` cache, simply cast it
 * `as CacheInterface<K, V, Tag, true>`. The key is provided but the tier
 * can safely ignore it.
 */
export abstract class MultiTierCache<
    K,
    V,
    // eslint-disable-next-line typescript/no-explicit-any
    Tiers extends readonly TierLike<K, V, CacheTag, any>[],
    CacheTag extends string = string
> {
    // Outer WR is computed, not stated by the user.
    private readonly _writeResultAvailable: boolean;

    private readonly inFlight: CacheSingleFlight<V> = new CacheSingleFlight();

    private _metrics: CacheMetrics | undefined;

    protected abstract cacheService: CacheServiceInterface;

    protected abstract logger: LoggerInterface;

    protected abstract metricsService: MetricsServiceInterface;

    // eslint-disable-next-line jsdoc-js/require-returns
    /**
     * The cache metrics.
     */
    protected get metrics(): CacheMetrics {
        this._metrics ??= this.initMetrics();
        return this._metrics;
    }

    constructor(
        readonly name: string,
        private readonly tiers: Tiers,
        readonly onInvalidationFailure?: OnInvalidationFailure
    ) {
        if (tiers.length === 0) {
            throw new InternalError('MultiTierCache requires at least one tier');
        }
        this._writeResultAvailable = tiers.some(t => t._writeResultAvailable === true);
    }

    private initMetrics(): CacheMetrics {
        return {
            hits: this.metricsService.getCounter('cache_hits_total', ['cache']),
            misses: this.metricsService.getCounter('cache_misses_total', ['cache']),
            writes: this.metricsService.getCounter('cache_writes_total', ['cache']),
            deletes: this.metricsService.getCounter('cache_deletes_total', ['cache']),
            invalidations: this.metricsService.getCounter('cache_invalidations_total', ['cache']),
            invalidationFailures: this.metricsService.getCounter('cache_invalidation_failures_total', ['cache']),
            errors: this.metricsService.getCounter('cache_errors_total', ['cache', 'operation']),
            inFlight: this.metricsService.getGauge('cache_in_flight', ['cache']),
            size: this.metricsService.getGauge('cache_size', ['cache']),
            sourceDuration: this.metricsService.getHistogram(
                'cache_source_duration_ms',
                ['cache', 'operation'],
                [1, 5, 10, 25, 50, 100, 250, 500, 1000]
            ),
            storeDuration: this.metricsService.getHistogram(
                'cache_store_duration_ms',
                ['cache', 'operation'],
                [1, 5, 10, 25, 50, 100, 250, 500]
            )
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    wrap<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: MultiWrapOptions<V, TArgs, CacheTag, Tiers>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const key: K = await keyFn(...args);

            for (const [i, tier] of this.tiers.entries()) {
                const cached: CachedValue<V> | undefined = await tier.store.get(key);
                // a store answers with what is still valid. This used to recognize an expired entry
                // and simply move on to the next tier, leaving it exactly where it was - taking up
                // room that live entries were then evicted to make
                if (cached) {
                    // Back‑fill earlier tiers. Per‑tier options are NOT used here
                    for (const earlierTier of this.tiers.slice(0, i)) {
                        earlierTier.setDirect(key, cached.value, {
                            ttl: cached.expiresAt
                                ? cached.expiresAt.getTime() - Date.now()
                                : undefined,
                            tags: cached.tags as CacheTag[]
                        // eslint-disable-next-line promise/prefer-await-to-then
                        }).catch(() => {});
                    }
                    this.metrics.hits.increase({ cache: this.name });
                    return cached.value;
                }
            }

            // miss. Counted once per caller rather than once per origin call, so that the hit rate
            // reads as what the callers experienced - the coalesced ones missed too
            this.metrics.misses.increase({ cache: this.name });

            // under single flight, so a hot key expiring sends one request to the origin instead of
            // one per caller waiting on it. Everything that fills the tiers belongs inside: a second
            // caller joining has to get the value back, not an empty cache and a second origin call
            return await this.runSingleFlight(key, async () => {
                const value: V = await fn(...args);

                // populate all tiers using per‑tier options
                await Promise.all(this.tiers.map(async (tier) => {
                    const tierOpt: CacheWrapOptions<V, TArgs, CacheTag> | undefined = options?.[tier.name as TierName<Tiers>];
                    const ttl: number | undefined = typeof tierOpt?.ttl === 'function'
                        ? await tierOpt.ttl(value, ...args)
                        : tierOpt?.ttl;
                    const tags: CacheTag[] | undefined = typeof tierOpt?.tags === 'function'
                        ? await tierOpt.tags(value, ...args)
                        : tierOpt?.tags;
                    await tier.setDirect(key, value, { ttl, tags }).catch(() => {});
                }));
                return value;
            });
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: OuterWR<Tiers> extends true
            ? ResultCacheKeyProvider<K, V, TArgs>
            : CacheKeyProvider<K, TArgs>,
        options?: MultiWrapWriteOptions<V, TArgs, CacheTag, Tiers>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const value: V = await fn(...args);
            const key: K = this._writeResultAvailable
                ? await (keyFn as ResultCacheKeyProvider<K, V, TArgs>)(value, ...args)
                : await (keyFn as CacheKeyProvider<K, TArgs>)(...args);

            const perTier: Partial<Record<TierName<Tiers>, CacheWrapOptions<V, TArgs, CacheTag>>> | undefined = options?.perCache;
            // eslint-disable-next-line sonarjs/cognitive-complexity
            await Promise.all(this.tiers.map(async (tier) => {
                const tierOpt: CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
                    | CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
                    | undefined = perTier?.[tier.name as TierName<Tiers>];
                let ttl: number | undefined;
                let tags: CacheTag[] | undefined;

                if (this._writeResultAvailable) {
                    const o: CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag> | undefined = tierOpt;
                    ttl = o?.ttl != undefined
                        ? typeof o.ttl === 'function' ? await o.ttl(value, ...args) : o.ttl
                        : undefined;
                    tags = o?.tags
                        ? typeof o.tags === 'function' ? await o.tags(value, ...args) : o.tags
                        : undefined;
                }
                else {
                    const o: CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag> | undefined = tierOpt as CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag> | undefined;
                    ttl = o?.ttl != undefined
                        ? typeof o.ttl === 'function' ? await o.ttl(...args) : o.ttl
                        : undefined;
                    tags = o?.tags
                        ? typeof o.tags === 'function' ? await o.tags(...args) : o.tags
                        : undefined;
                }

                await tier.setDirect(key, value, { ttl, tags }).catch(() => {});
            }));

            // global tag invalidation
            if (options?.invalidatesTags) {
                const tags: CacheTag[] = typeof options.invalidatesTags === 'function'
                    ? await options.invalidatesTags(...args)
                    : options.invalidatesTags;
                await this.safeInvalidateTags(tags);
            }
            return value;
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    wrapDelete<TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapDeleteOptions<TArgs, CacheTag>
    ): (...args: TArgs) => Promise<TReturn> {
        return async (...args) => {
            const cacheCtx: CacheContext = { cache: this.name, operation: CacheOperation.DELETE };
            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const res: TReturn = await fn(...args);
                const key: K = await keyFn(...args);
                cacheCtx.key = key;
                await Promise.all(this.tiers.map(async tier => await tier.store.delete(key)));
                this.metrics.deletes.increase({ cache: this.name });
                if (options?.invalidatesTags) {
                    const tags: CacheTag[] = typeof options.invalidatesTags === 'function'
                        ? await options.invalidatesTags(...args)
                        : options.invalidatesTags;
                    await this.safeInvalidateTags(tags);
                }
                return res;
            });
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    wrapInvalidate<TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        options: CacheWrapInvalidateOptions<TArgs, CacheTag>
    ): (...args: TArgs) => Promise<TReturn> {
        return async (...args) => {
            const cacheCtx: CacheContext = { cache: this.name, operation: CacheOperation.INVALIDATE };
            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const result: TReturn = await fn(...args);
                const tags: CacheTag[] = typeof options.invalidatesTags === 'function'
                    ? await options.invalidatesTags(...args)
                    : options.invalidatesTags;
                await this.safeInvalidateTags(tags);
                return result;
            });
        };
    }

    // eslint-disable-next-line jsdoc-js/require-returns
    /**
     * The tags any value in any tier might carry.
     *
     * A multi tier cache holds whatever its tiers hold, so its tags are their tags. Without this it
     * has none, and the cache service has no way to tell whether an invalidation concerns it - which
     * is how tag invalidation came to skip multi tier caches entirely.
     */
    get tags(): 'all' | readonly CacheTagMatcher[] {
        if (this.tiers.some(t => t.tags === 'all')) {
            return 'all';
        }
        return this.tiers.flatMap(t => [...t.tags as readonly CacheTagMatcher[]]);
    }

    /**
     * Removes every value carrying one of the given tags, from every tier.
     *
     * Goes to the tier stores directly rather than back through the cache service, which is what
     * safeInvalidateTags does and why that path was a no-op loop.
     * @param tags - The tags to invalidate.
     */
    async invalidateTags(tags: string[]): Promise<void> {
        await Promise.all(this.tiers.map(async t => await t.store.invalidateTags(tags)));
    }

    /**
     * Runs the given factory under the given key in single flight.
     * @param key - The key being filled.
     * @param factory - The work to do once.
     * @returns What the factory produced, for every caller that waited on it.
     */
    private async runSingleFlight(key: K, factory: () => Promise<V>): Promise<V> {
        try {
            return await this.inFlight.run(key, factory);
        }
        finally {
            this.metrics.inFlight.set({ cache: this.name }, this.inFlight.size);
        }
    }

    private async safeInvalidateTags(tags: CacheTag[]): Promise<void> {
        if (!tags.length) {
            return;
        }
        try {
            await this.cacheService.invalidateTags(tags);
            this.metrics.invalidations.increase({ cache: this.name });
        }
        catch (error) {
            this.metrics.invalidationFailures.increase({ cache: this.name });
            if (this.onInvalidationFailure === 'throw') {
                throw error;
            }
            this.logger.warn('Cache invalidation failed in multi‑tier cache', { error });
        }
    }
}