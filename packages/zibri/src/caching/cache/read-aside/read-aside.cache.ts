import { AlsUtilities } from '../../../context/als.utilities';
import { CacheContext } from '../../../context/cache/cache.context';
import { CachedValue } from '../../store/cached-value.model';
import { BaseCache } from '../base-cache.model';
import { CacheOperation } from '../cache-operation.enum';
import { CacheKeyProvider, CacheWrapOptions } from '../cache-options.model';

/**
 * Read‑aside base class.
 *
 * On a cache miss the source is called, but the result is **never** written
 * back to the cache.  Cache population happens only via explicit write
 * strategies (`wrapWrite`) or out‑of‑band processes.
 *
 * `wrapDelete` and `wrapInvalidate` work exactly like their read‑through
 * counterparts.
 */
export abstract class ReadAsideCache<
    K,
    V,
    CacheTag extends string,
    WriteResultAvailable extends boolean,
    N extends string
> extends BaseCache<K, V, CacheTag, WriteResultAvailable, N> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    wrap<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        // eslint-disable-next-line unusedImports/no-unused-vars
        options?: CacheWrapOptions<V, TArgs, CacheTag>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const cacheCtx: CacheContext = { cache: this.name, operation: CacheOperation.WRAP };
            const label: Record<string, string> = { cache: this.name };

            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                let key: K | undefined;

                // ---------- try cache read ----------
                try {
                    key = await keyFn(...args);
                    cacheCtx.key = key;

                    const storeStart: number = performance.now();
                    const cached: CachedValue<V> | undefined = await this.store.get(key);
                    this.metrics.storeDuration.observe(
                        { cache: this.name, operation: CacheOperation.WRAP },
                        performance.now() - storeStart
                    );

                    if (cached !== undefined) {
                        // expired → evict, but still treat as miss
                        if (cached.expiresAt !== undefined && cached.expiresAt.getTime() <= Date.now()) {
                            this.metrics.expiredEvictions.increase(label);
                            await Promise.resolve()
                                .then(() => this.store.delete(key as K))
                                .catch(() => undefined);
                            await this.updateSizeGauge();
                        }
                        else {
                            cacheCtx.hit = true;
                            this.metrics.hits.increase(label);
                            return cached.value;
                        }
                    }
                }
                catch (error) {
                    this.metrics.errors.increase({ cache: this.name, operation: CacheOperation.WRAP });
                    await this.logger.warn('Cache read failed, treating as miss', { error });
                }

                // ---------- cache miss ----------
                cacheCtx.hit = false;
                this.metrics.misses.increase(label);

                if (key == undefined) {
                    const start: number = performance.now();
                    const value: V = await fn(...args);
                    cacheCtx.durationInMs = performance.now() - start;
                    return value;
                }

                // Single‑flight: coalesce concurrent source calls for the same key.
                // This runs without store as we are in a read‑aside context.
                return this.runSingleFlight(key, async () => {
                    const sourceStart: number = performance.now();
                    const value: V = await fn(...args);
                    const sourceDuration: number = performance.now() - sourceStart;
                    cacheCtx.durationInMs = sourceDuration;
                    this.metrics.sourceDuration.observe(
                        { cache: this.name, operation: CacheOperation.WRAP },
                        sourceDuration
                    );
                    return value;
                });
            });
        };
    }
}