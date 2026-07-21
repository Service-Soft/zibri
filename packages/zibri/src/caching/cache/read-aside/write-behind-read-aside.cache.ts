import { AlsUtilities } from '../../../context/als.utilities';
import { CacheContext } from '../../../context/cache/cache.context';
import { CacheOperation } from '../cache-operation.enum';
import { ResultCacheKeyProvider, CacheWrapWriteOptionsWithResult, CacheSetDirectOptions } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadAsideCache } from './read-aside.cache';

/**
 * Write‑behind read‑aside cache.
 *
 * Writes update the source and then fire‑and‑forget a cache store.
 * Reads (`wrap`) check the cache but **never** populate it.
 */
export abstract class WriteBehindReadAsideCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadAsideCache<K, V, CacheTag, true, N>
    implements CacheInterface<K, V, CacheTag, true, N> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly _writeResultAvailable: true = true;

    // eslint-disable-next-line jsdoc/require-jsdoc
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

                await this.safeInvalidateTags(options?.invalidatesTags, value, args);

                const key: K = await keyFn(value, ...args);
                cacheCtx.key = key;
                const [tags, ttl] = await Promise.all([
                    this.resolveResultTags(options?.tags, value, args),
                    this.resolveResultTtl(options?.ttl, value, args)
                ]);

                // Fire‑and‑forget write
                Promise.resolve()
                    // eslint-disable-next-line promise/prefer-await-to-then
                    .then(async () => {
                        const storeStart: number = performance.now();
                        await this.store.set(key, this.createCachedValue(value, tags, ttl));
                        this.metrics.storeDuration.observe(
                            { cache: this.name, operation: 'SET' },
                            performance.now() - storeStart
                        );
                        this.metrics.writes.increase({ cache: this.name });
                        await this.updateSizeGauge();
                    })
                    // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
                    .catch(async (error) => {
                        this.metrics.errors.increase({ cache: this.name, operation: 'SET' });
                        await this.logger.warn(
                            'Background cache write failed',
                            { error }
                        );
                    });

                return value;
            });
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async setDirect(key: K, value: V, options?: CacheSetDirectOptions<CacheTag>): Promise<void> {
        const ttl: number | undefined = options?.ttl ?? await this.resolveResultTtl(undefined, value, []);
        const tags: CacheTag[] = options?.tags ?? [];
        Promise.resolve()
            // eslint-disable-next-line promise/prefer-await-to-then
            .then(async () => {
                const storeStart: number = performance.now();
                await this.store.set(key, this.createCachedValue(value, tags, ttl));
                this.metrics.storeDuration.observe({ cache: this.name, operation: 'SET' }, performance.now() - storeStart);
                this.metrics.writes.increase({ cache: this.name });
                await this.updateSizeGauge();
            })
            // eslint-disable-next-line promise/prefer-await-to-then, promise/prefer-await-to-callbacks
            .catch(async (error) => {
                this.metrics.errors.increase({ cache: this.name, operation: 'SET' });
                await this.logger.warn('Background cache write failed in setDirect', { error });
            });
    }
}