import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheWrapInvalidateOptions } from '../cache/cache-options.model';
import { CacheInterface } from '../cache/cache.interface';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method to invalidate some cached values resolved by the provided options using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param options - Additional options, including tags to invalidate.
 */
export function CacheInvalidate<K, V, CacheTag extends string, WriteResultAvailable extends boolean, TReturn, TArgs extends unknown[]>(
    cacheToken: DiToken<Pick<CacheInterface<K, V, CacheTag, WriteResultAvailable>, 'wrapInvalidate'>>,
    options: CacheWrapInvalidateOptions<TArgs, CacheTag>
) {
    return (
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<TReturn>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<TReturn>> => {
        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => Promise<TReturn> = descriptor.value!;
        const wrappedFns: WeakMap<object, (...args: TArgs) => Promise<TReturn>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<TReturn> {
            if (!wrappedFns.has(this)) {
                const cache: Pick<CacheInterface<K, V, CacheTag, WriteResultAvailable>, 'wrapInvalidate'> = inject(cacheToken);
                wrappedFns.set(this, cache.wrapInvalidate(original.bind(this), options));
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}