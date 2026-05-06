import { AlsUtilities } from '../../context/als.utilities';
import { LogCacheContext } from '../../logging/log-context.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { OmitStrict } from '../../types/omit-strict.type';
import { CacheMetrics } from '../cache-metrics.model';
import { CacheServiceInterface } from '../cache-service.interface';
import { CacheTagMatcher } from '../cache-tag-matchers';
import { CacheOperation } from './cache-operation.enum';
import { CacheKeyProvider, CacheSetDirectOptions, CacheTagsProvider, CacheTtlProvider, CacheWrapDeleteOptions, CacheWrapInvalidateOptions, OnInvalidationFailure, ResultCacheTagsProvider, ResultCacheTtlProvider } from './cache-options.model';
import { CacheInterface } from './cache.interface';
import { CacheStoreInterface } from '../store/cache-store.interface';
import { CachedValue } from '../store/cached-value.model';

/**
 * Shared base class of all caches.
 */
export abstract class BaseCache<K, V, CacheTag extends string, WriteResultAvailable extends boolean, N extends string>
implements OmitStrict<CacheInterface<K, V, CacheTag, WriteResultAvailable, N>, 'wrap' | 'wrapWrite'> {

    private readonly inFlight: Map<K, Promise<V>> = new Map();

    private _metrics: CacheMetrics | undefined;

    protected abstract cacheService: CacheServiceInterface;

    protected abstract logger: LoggerInterface;

    protected abstract metricsService: MetricsServiceInterface;

    abstract readonly _writeResultAvailable: WriteResultAvailable;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The cache metrics.
     */
    protected get metrics(): CacheMetrics {
        this._metrics ??= this.initMetrics();
        return this._metrics;
    }

    constructor(
        readonly name: N,
        readonly store: CacheStoreInterface<K, V>,
        readonly tags: 'all' | readonly CacheTagMatcher[],
        readonly defaultTtl?: number | (() => number | Promise<number>),
        readonly onInvalidationFailure?: OnInvalidationFailure
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapDelete<TReturn, TArgs extends unknown[]>(
        fn: (...args: TArgs) => TReturn | Promise<TReturn>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapDeleteOptions<TArgs, CacheTag>
    ): (...args: TArgs) => Promise<TReturn> {
        return async (...args) => {
            const cacheCtx: LogCacheContext = { cache: this.name, operation: CacheOperation.DELETE };

            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const sourceStart: number = performance.now();
                const res: TReturn = await fn(...args);
                cacheCtx.durationInMs = performance.now() - sourceStart;
                this.metrics.sourceDuration.observe({ cache: this.name, operation: CacheOperation.DELETE }, cacheCtx.durationInMs);

                await Promise.all([
                    Promise.resolve()
                        .then(async () => {
                            const key: K = await keyFn(...args);
                            cacheCtx.key = key;

                            const storeStart: number = performance.now();
                            await this.store.delete(key);
                            this.metrics.storeDuration.observe({ cache: this.name, operation: 'delete' }, performance.now() - storeStart);
                            this.metrics.deletes.increase({ cache: this.name });
                            await this.updateSizeGauge();
                        })
                        .catch(async (error) => {
                            this.metrics.errors.increase({ cache: this.name, operation: 'delete' });
                            await this.logger.warn(
                                'Cache deletion failed after successful source delete',
                                { error }
                            );
                        }),
                    this.safeInvalidateTags(options?.invalidatesTags, args)
                ]);

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
                const sourceStart: number = performance.now();
                const result: TReturn = await fn(...args);
                cacheCtx.durationInMs = performance.now() - sourceStart;
                this.metrics.sourceDuration.observe({ cache: this.name, operation: CacheOperation.INVALIDATE }, cacheCtx.durationInMs);

                await this.safeInvalidateTags(options.invalidatesTags, args);

                return result;
            });
        };
    }

    abstract setDirect(key: K, value: V, options?: CacheSetDirectOptions<CacheTag>): Promise<void>;

    private initMetrics(): CacheMetrics {
        const label: string[] = ['cache'];
        const labelWithOp: string[] = ['cache', 'operation'];

        return {
            hits: this.metricsService.getCounter('cache_hits_total', label),
            misses: this.metricsService.getCounter('cache_misses_total', label),
            writes: this.metricsService.getCounter('cache_writes_total', label),
            deletes: this.metricsService.getCounter('cache_deletes_total', label),
            invalidations: this.metricsService.getCounter('cache_invalidations_total', label),
            invalidationFailures: this.metricsService.getCounter('cache_invalidation_failures_total', label),
            expiredEvictions: this.metricsService.getCounter('cache_expired_evictions_total', label),
            errors: this.metricsService.getCounter('cache_errors_total', labelWithOp),
            inFlight: this.metricsService.getGauge('cache_in_flight', label),
            size: this.metricsService.getGauge('cache_size', label),
            sourceDuration: this.metricsService.getHistogram(
                'cache_source_duration_ms',
                labelWithOp,
                [1, 5, 10, 25, 50, 100, 250, 500, 1000]
            ),
            storeDuration: this.metricsService.getHistogram('cache_store_duration_ms', labelWithOp, [1, 5, 10, 25, 50, 100, 250, 500])
        };
    }

    /**
     * Updates the size gauge metric.
     */
    protected async updateSizeGauge(): Promise<void> {
        try {
            this.metrics.size.set({ cache: this.name }, await this.store.size());
        }
        catch {
            // not critical — never surface gauge update failures
        }
    }

    /**
     * Runs the given factory under the given key in single flight.
     * @param key - The key to check if a operation is already ongoing.
     * @param factory - The operation to run.
     * @returns The resolving promise.
     */
    protected async runSingleFlight(key: K, factory: () => Promise<V>): Promise<V> {
        const existing: Promise<V> | undefined = this.inFlight.get(key);
        if (existing !== undefined) {
            return existing;
        }

        const promise: Promise<V> = (async () => {
            try {
                return await factory();
            }
            finally {
                this.inFlight.delete(key);
                this.metrics.inFlight.set({ cache: this.name }, this.inFlight.size);
            }
        })();

        this.inFlight.set(key, promise);
        this.metrics.inFlight.set({ cache: this.name }, this.inFlight.size);
        return promise;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async safeInvalidateTags<TArgs extends unknown[]>(
        provider: CacheTagsProvider<TArgs, CacheTag> | undefined,
        args: TArgs
    ): Promise<void>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async safeInvalidateTags<TArgs extends unknown[]>(
        provider: ResultCacheTagsProvider<V, TArgs, CacheTag> | undefined,
        result: V,
        args: TArgs
    ): Promise<void>;
    /**
     * Safely invalidates tags.
     * @param provider - The provider for the tags to invalidate.
     * @param resultOrArgs - Either the result or The method arguments, depending on whether the result is available.
     * @param maybeArgs - The method arguments if a result is available, undefined otherwise.
     */
    protected async safeInvalidateTags<TArgs extends unknown[]>(
        provider: CacheTagsProvider<TArgs, CacheTag> | ResultCacheTagsProvider<V, TArgs, CacheTag> | undefined,
        resultOrArgs: V | TArgs,
        maybeArgs?: TArgs
    ): Promise<void> {
        try {
            const tags: CacheTag[] = maybeArgs !== undefined
                ? await this.resolveResultTags(provider as ResultCacheTagsProvider<V, TArgs, CacheTag>, resultOrArgs as V, maybeArgs)
                : await this.resolveArgTags(provider as CacheTagsProvider<TArgs, CacheTag>, resultOrArgs as TArgs);

            if (!tags.length) {
                return;
            }

            await this.cacheService.invalidateTags(tags);
            this.metrics.invalidations.increase({ cache: this.name });
            // size may have changed as other caches invalidated entries
            await this.updateSizeGauge();

        }
        catch (error) {
            this.metrics.invalidationFailures.increase({ cache: this.name });
            if (this.onInvalidationFailure === 'throw') {
                throw error;
            }
            else {
                await this.logger.warn(
                    'Cache invalidation failed, stale data may be served',
                    { error }
                );
            }
        }
    }

    /**
     * Resolves tags from a result provider.
     * @param provider - The provider to resolve the tags from.
     * @param result - The result.
     * @param args - Additional arguments.
     * @returns All resolved CacheTags.
     */
    protected async resolveResultTags<TArgs extends unknown[]>(
        provider: ResultCacheTagsProvider<V, TArgs, CacheTag> | undefined,
        result: V,
        args: TArgs
    ): Promise<CacheTag[]> {
        if (!provider) {
            return [];
        }
        if (typeof provider === 'function') {
            return await provider(result, ...args);
        }
        return provider;
    }

    /**
     * Resolves tags from a provider.
     * @param provider - The provider to resolve the tags from.
     * @param args - The arguments.
     * @returns All resolved CacheTags.
     */
    protected async resolveArgTags<TArgs extends unknown[]>(
        provider: CacheTagsProvider<TArgs, CacheTag> | undefined,
        args: TArgs
    ): Promise<CacheTag[]> {
        if (!provider) {
            return [];
        }
        if (typeof provider === 'function') {
            return await provider(...args);
        }
        return provider;
    }

    /**
     * Resolves ttl from a result provider.
     * @param provider - The provider to resolve the ttl from.
     * @param result - The result.
     * @param args - The arguments.
     * @returns The resolved time to live or undefined if values should be kept in cache without time limit.
     */
    protected async resolveResultTtl<TArgs extends unknown[]>(
        provider: ResultCacheTtlProvider<V, TArgs> | undefined,
        result: V,
        args: TArgs
    ): Promise<number | undefined> {
        if (provider == undefined) {
            if (typeof this.defaultTtl === 'function') {
                return await this.defaultTtl();
            }
            return this.defaultTtl;
        }
        if (typeof provider === 'function') {
            return await provider(result, ...args);
        }
        return provider;
    }

    /**
     * Resolves ttl from a provider.
     * @param provider - The provider to resolve the ttl from.
     * @param args - The arguments.
     * @returns The resolved time to live or undefined if values should be kept in cache without time limit.
     */
    protected async resolveArgsTtl<TArgs extends unknown[]>(
        provider: CacheTtlProvider<TArgs> | undefined,
        args: TArgs
    ): Promise<number | undefined> {
        if (provider == undefined) {
            if (typeof this.defaultTtl === 'function') {
                return await this.defaultTtl();
            }
            return this.defaultTtl;
        }
        if (typeof provider === 'function') {
            return await provider(...args);
        }
        return provider;
    }

    /**
     * Creates a cached value from the given input.
     * @param value - The value of the value to cache.
     * @param tags - The tags that should mark this cache entry.
     * @param ttl - The time that this cache entry should be valid.
     * @returns A cached value definition.
     */
    protected createCachedValue(value: V, tags: CacheTag[], ttl: number | undefined): CachedValue<V> {
        const createdAt: Date = new Date();
        const expiresAt: Date | undefined = ttl != undefined ? new Date(createdAt.getTime() + ttl) : undefined;

        return {
            createdAt,
            expiresAt,
            value,
            tags
        };
    }
}