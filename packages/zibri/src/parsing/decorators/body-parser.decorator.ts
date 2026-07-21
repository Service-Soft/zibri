import { Injectable, InjectableOptions } from '../../di/decorators/injectable.decorator';
import { DiVariants } from '../../di/models/di-variant.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Marks a request body parser.
 * @param options - Options for the body parser.
 */
export function BodyParser<T>(options: OmitStrict<InjectableOptions<T>, 'variant'> = {}): ClassDecorator {
    return target => Injectable({ ...options, variant: DiVariants.BODY_PARSER })(target);
}