import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheKeyProvider, CacheWrapDeleteOptions } from '../cache/cache-options.model';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method to delete a cached value under the resolved key using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param keyFn - How to resolve the key that should be deleted from the cache.
 * @param options - Additional options like tags to invalidate.
 */
export function CacheDelete<
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    C extends { wrapDelete: (...args: any[]) => any },
    K,
    CacheTag extends string,
    TReturn,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<C>,
    keyFn: CacheKeyProvider<K, TArgs>,
    options?: CacheWrapDeleteOptions<TArgs, CacheTag>
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
                // eslint-disable-next-line typescript/typedef
                const cache = inject(cacheToken);
                // eslint-disable-next-line typescript/no-unsafe-argument
                wrappedFns.set(this, cache.wrapDelete(original.bind(this), keyFn, options));
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return await wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}