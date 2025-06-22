import { NumberPropertyMetadata, PropertyMetadata } from '../../entity';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata, NumberParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateNumber(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey?: string
): ValidationProblem[] {
    const meta: NumberPropertyMetadata | NumberParamMetadata = metadata as NumberPropertyMetadata | NumberParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && (meta as NumberPropertyMetadata).default == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && (!meta.required || (meta as NumberPropertyMetadata).default != undefined)) {
        return [];
    }
    if (typeof property !== 'number') {
        return [new TypeMismatchValidationProblem(fullKey, 'number')];
    }
    if (meta.min != undefined && property < meta.min) {
        return [{ key: fullKey, message: `needs to be at least ${meta.min}` }];
    }
    if (meta.max != undefined && property > meta.max) {
        return [{ key: fullKey, message: `needs to be at most ${meta.max}` }];
    }
    return [];
}