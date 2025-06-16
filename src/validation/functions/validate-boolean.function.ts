import { PropertyMetadata } from '../../entity';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateBoolean(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined
): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && 'required' in metadata && metadata.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && 'required' in metadata && !metadata.required) {
        return [];
    }
    if (typeof property !== 'boolean') {
        return [new TypeMismatchValidationProblem(fullKey, 'boolean')];
    }
    return [];
}