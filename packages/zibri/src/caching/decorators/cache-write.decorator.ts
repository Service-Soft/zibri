import { ExtractCacheWriteResultAvailable } from './decorator-types';
import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly, CacheWrapWriteOptionsWithResult, ResultCacheKeyProvider } from '../cache/cache-options.model';
import { CacheInterface } from '../cache/cache.interface';
import { MultiTierCache, MultiWrapWriteOptions } from '../cache/multi-tier.cache';

/** Extract the wrapWrite options type for a given cache and TArgs. */
type ExtractWrapWriteOptions<C, TArgs extends unknown[]>
    // eslint-disable-next-line typescript/no-explicit-any
    = C extends MultiTierCache<any, infer V, infer Tiers, infer CacheTag>
        ? MultiWrapWriteOptions<V, TArgs, CacheTag, Tiers>
        // eslint-disable-next-line typescript/no-explicit-any
        : C extends Pick<CacheInterface<any, infer V, infer CacheTag, infer WR, any>, 'wrapWrite'>
            ? (WR extends true
                ? CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
                : CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>)
            : never;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method to write the result to the cache using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param keyFn - How to resolve the key under which results should be cached.
 * @param options - Additional options like ttl or tags.
 */
// eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
export function CacheWrite<C extends { wrapWrite: (...args: any[]) => any }, K, V, TArgs extends unknown[]>(
    cacheToken: DiToken<C>,
    keyFn: ExtractCacheWriteResultAvailable<C> extends true
        ? ResultCacheKeyProvider<K, V, TArgs>
        : CacheKeyProvider<K, TArgs>,
    options?: ExtractWrapWriteOptions<C, TArgs>
) {
    return function decorator(
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<V>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<V>> {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => Promise<V> = descriptor.value!;
        const wrappedFns: WeakMap<object, (...args: TArgs) => Promise<V>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<V> {
            if (!wrappedFns.has(this)) {
                // eslint-disable-next-line typescript/typedef
                const cache = inject(cacheToken);
                wrappedFns.set(
                    this,
                    // eslint-disable-next-line typescript/no-unsafe-argument
                    cache.wrapWrite(original.bind(this), keyFn, options)
                );
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}