import { PropertyMetadata } from '../../entity';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateNumberProperty(
    key: string,
    property: unknown,
    metadata: PropertyMetadata,
    parentKey?: string
): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && metadata.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && !metadata.required) {
        return [];
    }
    if (typeof property !== 'number') {
        return [{ key: fullKey, message: 'should be a number' }];
    }
    return [];
}