import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheKeyProvider, CacheWrapOptions } from '../cache/cache-options.model';
import { CacheInterface } from '../cache/cache.interface';
import { MultiTierCache, MultiWrapOptions } from '../cache/multi-tier.cache';

// eslint-disable-next-line jsdoc/require-jsdoc
type ExtractWrapOptions<C, TArgs extends unknown[]>
    // eslint-disable-next-line typescript/no-explicit-any
    = C extends MultiTierCache<any, infer V, infer Tiers, infer CacheTag>
        ? MultiWrapOptions<V, TArgs, CacheTag, Tiers>
        // eslint-disable-next-line typescript/no-explicit-any
        : C extends Pick<CacheInterface<any, infer V, infer CacheTag, any, any>, 'wrap'>
            ? CacheWrapOptions<V, TArgs, CacheTag>
            : never;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method for caching via the given cache token.
 * @param cacheToken - The token of the cache to use.
 * @param keyFn - How to resolve the key under which results are cached.
 * @param options - Additional options like ttl or tags.
 */
// eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
export function Cached<C extends { wrap: (...args: any[]) => any }, K, V, TArgs extends unknown[]>(
    cacheToken: DiToken<C>,
    keyFn: CacheKeyProvider<K, TArgs>,
    options?: ExtractWrapOptions<C, TArgs>
) {
    return (
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<V>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<V>> => {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => V | Promise<V> = descriptor.value!;
        const wrappedFns: WeakMap<object, (...args: TArgs) => Promise<V>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<V> {
            if (!wrappedFns.has(this)) {
                // eslint-disable-next-line typescript/typedef
                const cache = inject(cacheToken);
                // eslint-disable-next-line typescript/no-unsafe-argument
                wrappedFns.set(this, cache.wrap(original.bind(this), keyFn, options));
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return await wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}