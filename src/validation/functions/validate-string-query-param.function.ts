import { QueryParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateStringQueryParam(param: unknown, meta: QueryParamMetadata, parentKey?: string): ValidationProblem[] {
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