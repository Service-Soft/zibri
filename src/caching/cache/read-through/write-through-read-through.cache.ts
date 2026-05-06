import { AlsUtilities } from '../../../context/als.utilities';
import { LogCacheContext } from '../../../logging/log-context.model';
import { CacheOperation } from '../cache-operation.enum';
import { ResultCacheKeyProvider, CacheWrapWriteOptionsWithResult, CacheSetDirectOptions } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadThroughCache } from './read-through.cache';

/**
 * A write-through read-through cache.
 */
export abstract class WriteThroughReadThroughCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadThroughCache<K, V, CacheTag, true, N>
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
            const cacheCtx: LogCacheContext = { cache: this.name, operation: CacheOperation.WRITE };

            return AlsUtilities.runWithCacheContext(cacheCtx, async () => {
                const sourceStart: number = performance.now();
                const value: V = await fn(...args);
                const sourceDuration: number = performance.now() - sourceStart;
                cacheCtx.durationInMs = sourceDuration;
                this.metrics.sourceDuration.observe({ cache: this.name, operation: CacheOperation.WRITE }, sourceDuration);

                await this.safeInvalidateTags(options?.invalidatesTags, value, args);

                try {
                    const key: K = await keyFn(value, ...args);
                    cacheCtx.key = key;
                    const [tags, ttl] = await Promise.all([
                        this.resolveResultTags(options?.tags, value, args),
                        this.resolveResultTtl(options?.ttl, value, args)
                    ]);

                    const storeStart: number = performance.now();
                    await this.store.set(key, this.createCachedValue(value, tags, ttl));
                    this.metrics.storeDuration.observe({ cache: this.name, operation: 'set' }, performance.now() - storeStart);
                    this.metrics.writes.increase({ cache: this.name });
                    await this.updateSizeGauge();
                }
                catch (error) {
                    this.metrics.errors.increase({ cache: this.name, operation: 'set' });
                    await this.logger.warn(
                        'Cache store failed after successful source write, source write was not rolled back',
                        { error }
                    );
                }

                return value;
            });
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async setDirect(key: K, value: V, options?: CacheSetDirectOptions<CacheTag>): Promise<void> {
        try {
            const ttl: number | undefined = options?.ttl ?? await this.resolveResultTtl(undefined, value, []);
            const tags: CacheTag[] = options?.tags ?? [];
            await this.store.set(key, this.createCachedValue(value, tags, ttl));
            this.metrics.writes.increase({ cache: this.name });
            await this.updateSizeGauge();
        }
        catch (error) {
            this.metrics.errors.increase({ cache: this.name, operation: 'set' });
            await this.logger.warn('Cache store failed in setDirect', { error });
        }
    }
}