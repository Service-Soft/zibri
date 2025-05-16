import { PropertyMetadata } from '../../entity';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateDateProperty(
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
    if (!(property instanceof Date)) {
        return [{ key: fullKey, message: 'should be a date' }];
    }
    return [];
}