import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Marks a class that should be used as a rate limiter.
 * @param options - Options for the rate limiter.
 */
export function RateLimiter<T>(options: OmitStrict<InjectableOptions<T>, 'variant'> = {}): ClassDecorator {
    return Injectable({ ...options, variant: DiVariants.RATE_LIMITER });
}