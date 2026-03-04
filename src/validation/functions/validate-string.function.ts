import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { StringPropertyMetadata, StringFormat } from '../../entity/models/string-property-metadata.model';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { StringParamMetadata } from '../../routing/models/string-param-metadata.model';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

const UUID_REGEX: RegExp = /^[\dA-Fa-f]{8}-[\dA-Fa-f]{4}-[1-5][\dA-Fa-f]{3}-[89ABab][\dA-Fa-f]{3}-[\dA-Fa-f]{12}$/;
const EMAIL_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates the given string property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
// eslint-disable-next-line sonar/cognitive-complexity
export function validateString(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): ValidationProblem[] {
    const meta: StringPropertyMetadata | StringParamMetadata = metadata as StringPropertyMetadata | StringParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (
        property == undefined
        && (meta as StringPropertyMetadata).default == undefined
        && (typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
    ) {
        return [new IsRequiredValidationProblem(fullKey)];
    }
    if (
        property == undefined
        && (
            !(typeof metadata.required === 'boolean' ? metadata.required : metadata.required(entity))
            || (meta as StringPropertyMetadata).default != undefined
        )
    ) {
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
    if (meta.enum && !ObjectUtilities.values(meta.enum).includes(property)) {
        return [{ key: fullKey, message: `needs to match one of "${ObjectUtilities.values(meta.enum)}"` }];
    }
    if (meta.minLength && meta.minLength > property.length) {
        return [{ key: fullKey, message: `needs to be at least ${meta.minLength} characters long` }];
    }
    if (meta.maxLength && property.length > meta.maxLength) {
        return [{ key: fullKey, message: `needs to be at most ${meta.maxLength} characters long` }];
    }
    return [];
}

// eslint-disable-next-line jsdoc/require-jsdoc
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