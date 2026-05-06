
import { CacheOperation } from './cache-operation.enum';
import { CacheWrapOptions, CacheWrapWriteOptionsWithResult, CacheWrapWriteOptionsArgsOnly, CacheWrapDeleteOptions, CacheWrapInvalidateOptions, CacheKeyProvider, ResultCacheKeyProvider, OnInvalidationFailure, CacheTagsProvider, CacheSetDirectOptions } from './cache-options.model';
import { CacheInterface } from './cache.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { LogCacheContext } from '../../logging/log-context.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { CacheMetrics } from '../cache-metrics.model';
import { CacheServiceInterface } from '../cache-service.interface';
import { ExtractCacheWriteResultAvailable } from '../decorators/decorator-types';
import { CacheStoreInterface } from '../store/cache-store.interface';
import { CachedValue } from '../store/cached-value.model';

// eslint-disable-next-line jsdoc/require-jsdoc
type TierLike<K, V, CacheTag extends string, N extends string> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: N,
    // eslint-disable-next-line jsdoc/require-jsdoc
    store: CacheStoreInterface<K, V>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    _writeResultAvailable?: boolean,
    // eslint-disable-next-line typescript/method-signature-style
    setDirect(key: K, value: V, options?: CacheSetDirectOptions<CacheTag>): Promise<void>
};

// eslint-disable-next-line typescript/no-explicit-any, jsdoc/require-jsdoc
type TierName<Tiers extends readonly TierLike<any, any, any, any>[]> = Tiers[number]['name'];

/** Outer WR – true if any tier is true, else false. */
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

/** Per‑tier wrap options – just `CacheWrapOptions` for each tier. */
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
 * `as CacheInterface<K, V, Tag, true>` – the key is provided but the tier
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

    private _metrics: CacheMetrics | undefined;

    protected abstract cacheService: CacheServiceInterface;

    protected abstract logger: LoggerInterface;

    protected abstract metricsService: MetricsServiceInterface;

    // eslint-disable-next-line jsdoc/require-returns
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
            throw new Error('MultiTierCache requires at least one tier');
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
            expiredEvictions: this.metricsService.getCounter('cache_expired_evictions_total', ['cache']),
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrap<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: MultiWrapOptions<V, TArgs, CacheTag, Tiers>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const key: K = await keyFn(...args);

            for (let i: number = 0; i < this.tiers.length; i++) {
                const cached: CachedValue<V> | undefined = await this.tiers[i].store.get(key);
                if (cached && (!cached.expiresAt || cached.expiresAt > new Date())) {
                    // back‑fill earlier tiers – per‑tier options are NOT used here
                    for (let j: number = 0; j < i; j++) {
                        this.tiers[j].setDirect(key, cached.value, {
                            ttl: cached.expiresAt
                                ? cached.expiresAt.getTime() - Date.now()
                                : undefined,
                            tags: cached.tags as CacheTag[]
                        // eslint-disable-next-line promise/prefer-await-to-then
                        }).catch(() => {});
                    }
                    return cached.value;
                }
            }

            // miss
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
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
            // eslint-disable-next-line sonar/cognitive-complexity
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
                    // eslint-disable-next-line stylistic/max-len
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapDelete<TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapDeleteOptions<TArgs, CacheTag>
    ): (...args: TArgs) => Promise<TReturn> {
        return async (...args) => {
            const cacheCtx: LogCacheContext = { cache: this.name, operation: CacheOperation.DELETE };
            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const res: TReturn = await fn(...args);
                const key: K = await keyFn(...args);
                cacheCtx.key = key;
                await Promise.all(this.tiers.map(tier => tier.store.delete(key)));
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapInvalidate<TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        options: CacheWrapInvalidateOptions<TArgs, CacheTag>
    ): (...args: TArgs) => Promise<TReturn> {
        return async (...args) => {
            const cacheCtx: LogCacheContext = { cache: this.name, operation: CacheOperation.INVALIDATE };
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
            await this.logger.warn('Cache invalidation failed in multi‑tier cache', { error });
        }
    }
}