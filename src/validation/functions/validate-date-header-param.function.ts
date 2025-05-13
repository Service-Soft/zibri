import { HeaderParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, ValidationProblem } from '../validation-problem.model';

export function validateDateHeaderParam(param: unknown, meta: HeaderParamMetadata, parentKey?: string): ValidationProblem[] {
    const fullKey: string = parentKey ? `${parentKey}.${meta.name}` : meta.name as string;
    if (param == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (param == undefined && !meta.required) {
        return [];
    }
    if (!(param instanceof Date)) {
        return [{ key: fullKey, message: 'should be a date' }];
    }
    return [];
}