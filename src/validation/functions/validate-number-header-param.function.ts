import { HeaderParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateNumberHeaderParam(param: unknown, meta: HeaderParamMetadata, parentKey?: string): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name as string;
    if (param == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (param == undefined && !meta.required) {
        return [];
    }
    if (typeof param !== 'number') {
        return [{ key: fullKey, message: 'should be a number' }];
    }
    return [];
}