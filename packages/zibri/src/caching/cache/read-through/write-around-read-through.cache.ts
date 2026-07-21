import { AlsUtilities } from '../../../context/als.utilities';
import { CacheContext } from '../../../context/cache/cache.context';
import { CacheOperation } from '../cache-operation.enum';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadThroughCache } from './read-through.cache';

/**
 * A write-around read-through cache.
 * Reads go through the cache, writes bypass the cache.
 */
export abstract class WriteAroundReadThroughCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadThroughCache<K, V, CacheTag, false, N>
    implements CacheInterface<K, V, CacheTag, false, N> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly _writeResultAvailable: false = false;

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        _keyFn: CacheKeyProvider<K, TArgs>,
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

                await this.safeInvalidateTags(options?.invalidatesTags, args);
                this.metrics.writes.increase({ cache: this.name });

                return value;
            });
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async setDirect(): Promise<void> {
        // Write‑around: intentionally does not cache writes.
    }
}