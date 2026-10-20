import { inject } from '../../di/inject.function.ts';
import { DiToken } from '../../di/models/di-token.model.ts';
import { CacheWrapInvalidateOptions } from '../cache/cache-options.model.ts';

// eslint-disable-next-line jsdoc-js/require-returns
/**
 * Marks the method to invalidate some cached values resolved by the provided options using the provided cache.
 * @param cacheToken - The token of the cache to use.
 * @param options - Additional options, including tags to invalidate.
 */
export function CacheInvalidate<
    // eslint-disable-next-line jsdoc-js/require-jsdoc, typescript/no-explicit-any
    C extends { wrapInvalidate: (...args: any[]) => any },
    CacheTag extends string,
    TReturn,
    TArgs extends unknown[]
>(
    cacheToken: DiToken<C>,
    // TArgs is the decorated method's, inferred from the method alone through the decorator this
    // returns, so a tag provider may take fewer arguments than the method - see CacheWrite
    options: NoInfer<CacheWrapInvalidateOptions<TArgs, CacheTag>>
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
                // eslint-disable-next-line typescript-js/typedef
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