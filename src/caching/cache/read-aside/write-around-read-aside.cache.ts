import { AlsUtilities } from '../../../context/als.utilities';
import { LogCacheContext } from '../../../logging/log-context.model';
import { CacheOperation } from '../cache-operation.enum';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly } from '../cache-options.model';
import { CacheInterface } from '../cache.interface';
import { ReadAsideCache } from './read-aside.cache';

/**
 * Write‑around read‑aside cache.
 *
 * Writes update the source and then only invalidate tags (no cache population).
 * Reads (`wrap`) check the cache but **never** populate it.
 */
export abstract class WriteAroundReadAsideCache<K, V, N extends string, CacheTag extends string = string>
    extends ReadAsideCache<K, V, CacheTag, false, N>
    implements CacheInterface<K, V, CacheTag, false, N> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly _writeResultAvailable: false = false;

    // eslint-disable-next-line jsdoc/require-jsdoc
    wrapWrite<TArgs extends unknown[]>(
        fn: (...args: TArgs) => V | Promise<V>,
        _keyFn: CacheKeyProvider<K, TArgs>, // kept for interface compatibility, never used
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