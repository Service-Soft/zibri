import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { DatePropertyMetadata } from '../../entity/models/date-property-metadata.model';
import { FormatDateFn } from '../../localization/formatting/format-date-fn.model';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { DateParamMetadata } from '../../routing/models/date-param-metadata.model';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given date property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
export function validateDate(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): ValidationProblem[] {
    const meta: DatePropertyMetadata | DateParamMetadata = metadata as DatePropertyMetadata | DateParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (
        property == undefined
        && (meta as DatePropertyMetadata).default == undefined
        && (typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
    ) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (
        property == undefined
        && (
            !(typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
            || (meta as DatePropertyMetadata).default != undefined
        )
    ) {
        return [];
    }
    if (!(property instanceof Date)) {
        return [new TypeMismatchValidationProblem(fullKey, 'date')];
    }
    if (meta.before != undefined && new Date(property).getTime() >= meta.before.getTime()) {
        const formatDate: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);
        return [{ key: fullKey, message: `should be before "${formatDate(meta.before, true)}"` }];
    }
    if (meta.after != undefined && new Date(property).getTime() <= meta.after.getTime()) {
        const formatDate: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);
        return [{ key: fullKey, message: `should be after "${formatDate(meta.after, true)}"` }];
    }
    return [];
}