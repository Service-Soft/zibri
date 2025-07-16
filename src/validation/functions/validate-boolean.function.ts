import { BooleanPropertyMetadata, PropertyMetadata } from '../../entity';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata, BooleanParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given boolean property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @returns All validation problems found.
 */
export function validateBoolean(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined
): ValidationProblem[] {
    const meta: BooleanPropertyMetadata | BooleanParamMetadata = metadata as BooleanPropertyMetadata | BooleanParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && (meta as BooleanPropertyMetadata).default == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && (!meta.required || (meta as BooleanPropertyMetadata).default != undefined)) {
        return [];
    }
    if (typeof property !== 'boolean') {
        return [new TypeMismatchValidationProblem(fullKey, 'boolean')];
    }
    return [];
}