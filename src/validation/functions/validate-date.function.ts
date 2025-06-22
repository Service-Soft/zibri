import { inject, ZIBRI_DI_TOKENS } from '../../di';
import { DatePropertyMetadata, PropertyMetadata } from '../../entity';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata, DateParamMetadata } from '../../routing';
import { FormatDateFn } from '../../utilities';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateDate(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey?: string
): ValidationProblem[] {
    const meta: DatePropertyMetadata | DateParamMetadata = metadata as DatePropertyMetadata | DateParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && (meta as DatePropertyMetadata).default == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && (!meta.required || (meta as DatePropertyMetadata).default != undefined)) {
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