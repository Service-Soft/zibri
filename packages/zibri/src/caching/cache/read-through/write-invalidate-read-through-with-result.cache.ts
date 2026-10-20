import { AlsUtilities } from '../../../context/als.utilities.ts';
import { CacheContext } from '../../../context/cache/cache.context.ts';
import { CacheOperation } from '../cache-operation.enum.ts';
import { ResultCacheKeyProvider, CacheWrapWriteOptionsWithResult } from '../cache-options.model.ts';
import { CacheInterface } from '../cache.interface.ts';
import { ReadThroughCache } from './read-through.cache.ts';

/**
 * Write‑invalidate (key from result) read‑through cache.
 *
 * After a successful source write, the cache entry identified by the
 * **result** is deleted (typically after a creation that generates an ID).
 */
export abstract class WriteInvalidateReadThroughWithResultCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadThroughCache<K, V, CacheTag, true, N>
    implements CacheInterface<K, V, CacheTag, true, N> {

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly _writeResultAvailable: true = true;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: ResultCacheKeyProvider<K, V, TArgs>,
        options?: CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
    ): (...args: TArgs) => Promise<V> {
        return async (...args) => {
            const cacheCtx: CacheContext = { cache: this.name, operation: CacheOperation.WRITE };

            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const sourceStart: number = performance.now();
                const value: V = await fn(...args);
                const sourceDuration: number = performance.now() - sourceStart;
                cacheCtx.durationInMs = sourceDuration;
                this.metrics.sourceDuration.observe(
                    { cache: this.name, operation: CacheOperation.WRITE },
                    sourceDuration
                );

                // Invalidate tags and delete the result‑based key
                await Promise.all([
                    this.safeInvalidateTags(options?.invalidatesTags, value, args),
                    Promise.resolve()
                        .then(async () => {
                            const key: K = await keyFn(value, ...args);
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
                        .catch((error) => {
                            this.metrics.errors.increase({ cache: this.name, operation: 'delete' });
                            this.logger.warn(
                                'Cache invalidation (delete) failed after successful source write',
                                { error }
                            );
                        })
                ]);

                return value;
            });
        };
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async setDirect(key: K): Promise<void> {
        try {
            const storeStart: number = performance.now();
            await this.store.delete(key);
            this.metrics.storeDuration.observe({ cache: this.name, operation: 'delete' }, performance.now() - storeStart);
            this.metrics.deletes.increase({ cache: this.name });
            await this.updateSizeGauge();
        }
        catch (error) {
            this.metrics.errors.increase({ cache: this.name, operation: 'delete' });
            this.logger.warn('Cache invalidation (delete) failed in setDirect', { error });
        }
    }
}