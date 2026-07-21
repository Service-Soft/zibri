import { inject } from '../../di/inject.function';
import { DiToken } from '../../di/models/di-token.model';
import { HttpStatus } from '../../http/http-status.enum';
import { OpenApiResponse } from '../../open-api/open-api.model';
import { isNewable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { RateLimiterInterface } from '../limiter/rate-limiter.interface';
import { RateLimitWrapOptions } from '../rate-limit-wrap-options.model';
import { SuccessRateLimitReservationResult } from '../reservation/rate-limit-reservation-result.model';
import { BaseRateLimitState } from '../stores/rate-limiter-store.interface';

/**
 * Options for the \@RateLimited decorator.
 */
export type RateLimitedOptions<TArgs extends unknown[]> = RateLimitWrapOptions<TArgs>;

// eslint-disable-next-line jsdoc/require-returns
/**
 * Marks the method for rate limiting using the provided limiter.
 * @param limiterProvider - The provider for the limiter. Can either be a di token or a function that returns a di token.
 * @param options - Additional options, like eg. The key function (eg. When the rate limit is per user) or count function.
 */
// eslint-disable-next-line typescript/no-explicit-any
export function RateLimited<TArgs extends unknown[], C extends RateLimiterInterface<any>, V>(
    limiterProvider: DiToken<C>
        | (() => DiToken<C> | Promise<DiToken<C>>),
    options?: RateLimitedOptions<TArgs>
) {
    return (
        target: object,
        propertyKey: string | symbol,
        descriptor: TypedPropertyDescriptor<(...args: TArgs) => Promise<V>>
    ): TypedPropertyDescriptor<(...args: TArgs) => Promise<V>> => {
        const ctor: Function = target.constructor;

        if (options?.reserveIfUnavailable === true) {
            const responses: OpenApiResponse[] = MetadataUtilities.getRouteResponses(ctor, propertyKey.toString());
            responses.push({
                type: 'json',
                cls: SuccessRateLimitReservationResult,
                isArray: undefined,
                status: HttpStatus.ACCEPTED,
                implicit: true
            });
            MetadataUtilities.setRouteResponses(ctor, responses, propertyKey.toString());
        }

        // eslint-disable-next-line typescript/no-non-null-assertion
        const original: (...args: TArgs) => V | Promise<V> = descriptor.value!;
        const wrappedFns: WeakMap<object, Map<DiToken<C>, (...args: TArgs) => Promise<V>>> = new WeakMap();

        descriptor.value = async function(this: object, ...args: TArgs): Promise<V> {
            const token: DiToken<C> = typeof limiterProvider === 'function' && !isNewable(limiterProvider)
                ? await limiterProvider()
                : limiterProvider;

            if (!wrappedFns.has(this)) {
                wrappedFns.set(this, new Map());
            }

            // eslint-disable-next-line typescript/no-non-null-assertion
            const instanceCache: Map<DiToken<C>, (...args: TArgs) => Promise<V>> = wrappedFns.get(this)!;

            if (!instanceCache.has(token)) {
                const limiter: RateLimiterInterface<BaseRateLimitState> = inject(token);
                instanceCache.set(token, limiter.wrap(original.bind(this), options));
            }

            // eslint-disable-next-line typescript/no-non-null-assertion
            return await instanceCache.get(token)!(...args);
        };

        return descriptor;
    };
}