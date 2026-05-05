import { AlsUtilities } from '../../../context/als.utilities';
import { LogCacheContext } from '../../../logging/log-context.model';
import { CacheOperation } from '../cache-operation.enum';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadThroughCache } from './read-through.cache';

/**
 * Write‑invalidate (key from arguments) read‑through cache.
 *
 * After the source write succeeds, the cache entry identified by the
 * argument‑derived key is **deleted**, and optional tag invalidations
 * are fired.
 */
export abstract class WriteInvalidateReadThroughArgsOnlyCache<K, V, CacheTag extends string = string>
    extends ReadThroughCache<K, V, CacheTag>
    implements CacheInterface<K, V, CacheTag, false> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
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

                // Invalidate tags and delete the specific key, in parallel
                await Promise.all([
                    this.safeInvalidateTags(options?.invalidatesTags, args),
                    Promise.resolve()
                        .then(async () => {
                            const key: K = keyFn(...args);
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