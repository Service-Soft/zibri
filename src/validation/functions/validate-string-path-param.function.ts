import { PathParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateStringPathParam(param: unknown, meta: PathParamMetadata, parentKey?: string): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name;
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