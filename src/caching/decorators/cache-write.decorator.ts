import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheKeyProvider, CacheWrapWriteOptionsArgsOnly, CacheWrapWriteOptionsWithResult, ResultCacheKeyProvider } from '../cache/cache-options.model';
import { CacheInterface } from '../cache/cache.interface';

/**
 * Marks the method to write the result to the cache using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param keyFn - How to resolve the key under which results should be cached.
 * @param options - Additional options like ttl or tags.
 */
export function CacheWrite<
    K,
    V,
    CacheTag extends string,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<Pick<CacheInterface<K, V, CacheTag, true>, 'wrapWrite'>>,
    keyFn: ResultCacheKeyProvider<K, V, TArgs>,
    options?: CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
): MethodDecorator;
export function CacheWrite<
    K,
    V,
    CacheTag extends string,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<Pick<CacheInterface<K, V, CacheTag, false>, 'wrapWrite'>>,
    keyFn: CacheKeyProvider<K, TArgs>,
    options?: CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
): MethodDecorator;
export function CacheWrite<
    K,
    V,
    CacheTag extends string,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<Pick<CacheInterface<K, V, CacheTag, boolean>, 'wrapWrite'>>,
    keyFn: CacheKeyProvider<K, TArgs> | ResultCacheKeyProvider<K, V, TArgs>,
    options?: CacheWrapWriteOptionsArgsOnly<TArgs, CacheTag>
        | CacheWrapWriteOptionsWithResult<V, TArgs, CacheTag>
): MethodDecorator {
    return ((
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<V>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<V>> => {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => Promise<V> = descriptor.value!;
        const wrappedFns: WeakMap<object, (...args: TArgs) => Promise<V>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<V> {
            let wrapped: ((...args: TArgs) => Promise<V>) | undefined = wrappedFns.get(this);

            if (wrapped === undefined) {
                const cache: Pick<CacheInterface<K, V, CacheTag, boolean>, 'wrapWrite'> = inject(cacheToken);
                wrapped = cache.wrapWrite(
                    original.bind(this),
                    keyFn as never,
                    options as never
                );
                wrappedFns.set(this, wrapped);
            }

            return wrapped(...args);
        };

        return descriptor;
    }) as MethodDecorator;
}