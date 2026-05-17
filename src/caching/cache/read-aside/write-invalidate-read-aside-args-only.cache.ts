import { AlsUtilities } from '../../../context/als.utilities';
import { CacheContext } from '../../../context/cache/cache.context';
import { CacheOperation } from '../cache-operation.enum';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadAsideCache } from './read-aside.cache';

/**
 * Write‑invalidate (key from arguments) read‑aside cache.
 *
 * After a source write, the cache entry derived from **arguments** is deleted.
 * Reads (`wrap`) check the cache but **never** populate it.
 */
export abstract class WriteInvalidateReadAsideArgsOnlyCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadAsideCache<K, V, CacheTag, false, N>
    implements CacheInterface<K, V, CacheTag, false, N> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly _writeResultAvailable: false = false;

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        keyFn: CacheKeyProvider<K, TArgs>,
        options?: CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
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

                await Promise.all([
                    this.safeInvalidateTags(options?.invalidatesTags, args),
                    Promise.resolve()
                        .then(async () => {
                            const key: K = await keyFn(...args);
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

    // eslint-disable-next-line jsdoc/require-jsdoc
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
            await this.logger.warn('Cache invalidation (delete) failed in setDirect', { error });
        }
    }
}