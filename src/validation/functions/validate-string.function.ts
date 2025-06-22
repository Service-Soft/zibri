
import { PropertyMetadata, StringFormat, StringPropertyMetadata } from '../../entity';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata, StringParamMetadata } from '../../routing';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

const UUID_REGEX: RegExp = /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[1-5][\dA-Fa-f]{3}-[89ABab][\dA-Fa-f]{3}-[\dA-Fa-f]{12}$/;
const EMAIL_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateString(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey?: string
): ValidationProblem[] {
    const meta: StringPropertyMetadata | StringParamMetadata = metadata as StringPropertyMetadata | StringParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined && (meta as StringPropertyMetadata).default == undefined && meta.required) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (property == undefined && (!meta.required || (meta as StringPropertyMetadata).default != undefined)) {
        return [];
    }
    if (typeof property !== 'string') {
        return [new TypeMismatchValidationProblem(fullKey, 'string')];
    }
    if (meta.format && !isFormatValid(meta.format, property)) {
        return [{ key: fullKey, message: `needs to be in format "${meta.format}"` }];
    }
    if (meta.regex != undefined && !new RegExp(meta.regex).test(property)) {
        return [{ key: fullKey, message: `needs to match regex "${meta.regex}"` }];
    }
    if (meta.enum && !Object.values(meta.enum).includes(property)) {
        return [{ key: fullKey, message: `needs to match one of "${Object.values(meta.enum)}"` }];
    }
    if (meta.minLength && meta.minLength > property.length) {
        return [{ key: fullKey, message: `needs to be at least ${meta.minLength} characters long` }];
    }
    if (meta.maxLength && property.length > meta.maxLength) {
        return [{ key: fullKey, message: `needs to be at most ${meta.maxLength} characters long` }];
    }
    return [];
}

function isFormatValid(format: StringFormat, value: string): boolean {
    switch (format) {
        case 'uuid': {
            return UUID_REGEX.test(value);
        }
        case 'email': {
            return EMAIL_REGEX.test(value);
        }
    }
}