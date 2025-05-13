import { HeaderParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateStringHeaderParam(param: unknown, meta: HeaderParamMetadata, parentKey?: string): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name as string;
    // eslint-disable-next-line typescript/strict-boolean-expressions
    if (!param && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (param == undefined && !meta.required) {
        return [];
    }
    if (typeof param !== 'string') {
        return [{ key: fullKey, message: 'should be a string' }];
    }
    return [];
}