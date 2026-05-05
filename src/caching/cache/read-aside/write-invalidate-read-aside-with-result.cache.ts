import { AlsUtilities } from '../../../context/als.utilities';
import { LogCacheContext } from '../../../logging/log-context.model';
import { CacheOperation } from '../cache-operation.enum';
import { ResultCacheKeyProvider, CacheWrapWriteOptionsWithResult } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadAsideCache } from './read-aside.cache';

/**
 * Write‑invalidate (key from result) read‑aside cache.
 *
 * After a source write, the cache entry derived from the **result** is deleted.
 * Reads (`wrap`) check the cache but **never** populate it.
 */
export abstract class WriteInvalidateReadAsideWithResultCache<K, V, CacheTag extends string = string>
    extends ReadAsideCache<K, V, CacheTag>
    implements CacheInterface<K, V, CacheTag, true> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: ResultCacheKeyProvider<K, V, TArgs>,
        options?: CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const cacheCtx: LogCacheContext = { cache: this.name, operation: CacheOperation.WRITE };

            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const sourceStart: number = performance.now();
                const value: V = await fn(...args);
                const sourceDuration: number = performance.now() - sourceStart;
                cacheCtx.durationInMs = sourceDuration;
                this.metrics.sourceDuration.observe(
                    { cache: this.name, operation: CacheOperation.WRITE },
                    sourceDuration
                );

                await Promise.all([
                    this.safeInvalidateTags(options?.invalidatesTags, value, args),
                    Promise.resolve()
                        .then(async () => {
                            const key: K = keyFn(value, ...args);
                            cacheCtx.key = key;

                            const storeStart: number = performance.now();
                            await this.store.delete(key);
                            this.metrics.storeDuration.observe(
                                { cache: this.name, operation: 'delete' },
                                performance.now() - storeStart
                            );
                            this.metrics.deletes.increase({ cache: this.name });
                            await this.updateSizeGauge();
                        })
                        .catch(async (error) => {
                            this.metrics.errors.increase({ cache: this.name, operation: 'delete' });
                            await this.logger.warn(
                                'Cache invalidation (delete) failed after successful source write',
                                { error }
                            );
                        })
                ]);

                return value;
            });
        };
    }
}