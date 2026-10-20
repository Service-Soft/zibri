import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { DiVariants } from '../../di/models/di-variant.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Marks a class that should be used as a cache.
 * @param options - Options for the cache.
 */
export function Cache<T>(options: OmitStrict<InjectableOptions<T>, 'variant'> = {}): ClassDecorator {
    return Injectable({ ...options, variant: DiVariants.CACHE });
}