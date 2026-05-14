import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { CacheWrapInvalidateOptions } from '../cache/cache-options.model';

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method to invalidate some cached values resolved by the provided options using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param options - Additional options, including tags to invalidate.
 */
export function CacheInvalidate<
    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    C extends { wrapInvalidate: (...args: any[]) => any },
    CacheTag extends string,
    TReturn,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<C>,
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
                // eslint-disable-next-line typescript/typedef
                const cache = inject(cacheToken);
                // eslint-disable-next-line typescript/no-unsafe-argument
                wrappedFns.set(this, cache.wrapInvalidate(original.bind(this), options));
            }
            // eslint-disable-next-line typescript/no-non-null-assertion
            return wrappedFns.get(this)!(...args);
        };

        return descriptor;
    };
}