import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheKeyProvider, CacheWrapOptions } from '../cache/cache-options.model';
import { CacheInterface } from '../cache/cache.interface';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method for caching via the given cache token.
 * @param cacheToken - The token of the cache to use.
 * @param keyFn - How to resolve the key under which results are cached.
 * @param options - Additional options like ttl or tags.
 */
export function Cached<K, V, CacheTag extends string, WriteResultAvailable extends boolean, TArgs extends unknown[]>(
    cacheToken: DiToken<Pick<CacheInterface<K, V, CacheTag, WriteResultAvailable>, 'wrap'>>,
    keyFn: CacheKeyProvider<K, TArgs>,
    options?: CacheWrapOptions<V, TArgs, CacheTag>
) {
    return (
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<V>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<V>> => {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => Promise<V> = descriptor.value!;
        const wrappedFns: WeakMap<object, (...args: TArgs) => Promise<V>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<V> {
            if (!wrappedFns.has(this)) {
                const cache: Pick<CacheInterface<K, V, CacheTag, WriteResultAvailable>, 'wrap'> = inject(cacheToken);
                wrappedFns.set(this, cache.wrap(original.bind(this), keyFn, options));
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}