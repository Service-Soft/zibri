import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { StoredStringPropertyMetadata, StringFormat } from '../../entity/models/string-property-metadata.model';
import { ValidationProblemCode } from '../../error-handling/validation-problem-code.enum';
import { $ts } from '../../localization/translate.function';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { StringParamMetadata } from '../../routing/models/string-param-metadata.model';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { RegexUtilities } from '../../utilities/regex.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

const EMAIL_REGEX: RegExp = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// E.164: a plus, a country code that does not start with 0, and at most 15 digits in all
const PHONE_REGEX: RegExp = /^\+[1-9]\d{6,14}$/;

/**
 * Validates the given string property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
export async function validateString(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    const meta: StoredStringPropertyMetadata | StringParamMetadata
        = metadata as StoredStringPropertyMetadata | StringParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean'
            ? metadata.required
            : await metadata.required(entity, context);
        const hasDefault: boolean = (meta as StoredStringPropertyMetadata).default != undefined;
        return isRequired && !hasDefault ? [new IsRequiredValidationProblem(fullKey)] : [];
    }
    return stringValueProblems(fullKey, property, meta);
}

/**
 * The problems of a string value that is there, judged by the value alone.
 *
 * Everything about a string except whether it may be left out, which can depend on the request.
 * What decides which of several shapes a value is uses exactly this, so it cannot disagree with
 * validation about any rule it looks at.
 * @param fullKey - The key the problems are reported under.
 * @param property - The value.
 * @param meta - What the string is declared as.
 * @returns All validation problems found.
 */
export function stringValueProblems(
    fullKey: string,
    property: unknown,
    meta: StoredStringPropertyMetadata | StringParamMetadata
): ValidationProblem[] {
    if (typeof property !== 'string') {
        return [new TypeMismatchValidationProblem(fullKey, 'string')];
    }
    if (meta.format && !isFormatValid(meta.format, property)) {
        return [{ key: fullKey, code: ValidationProblemCode.FORMAT, message: $ts`needs to be in format "${meta.format}"` }];
    }
    if (meta.regex != undefined && !RegexUtilities.resolveLinear(meta.regex).test(property)) {
        return [{ key: fullKey, code: ValidationProblemCode.REGEX, message: $ts`needs to match regex "${meta.regex}"` }];
    }
    if (meta.enum && !ObjectUtilities.values(meta.enum).includes(property)) {
        return [
            {
                key: fullKey,
                code: ValidationProblemCode.ENUM,
                message: $ts`needs to match one of "${ObjectUtilities.values(meta.enum)}"`
            }
        ];
    }
    // in characters, as the OpenAPI schema states the bounds: an emoji is one, and two utf-16 units
    const length: number = [...property].length;
    if (meta.minLength && meta.minLength > length) {
        return [
            {
                key: fullKey,
                code: ValidationProblemCode.MIN_LENGTH,
                message: $ts`needs to be at least ${meta.minLength} characters long`
            }
        ];
    }
    if (meta.maxLength && length > meta.maxLength) {
        return [
            {
                key: fullKey,
                code: ValidationProblemCode.MAX_LENGTH,
                message: $ts`needs to be at most ${meta.maxLength} characters long`
            }
        ];
    }
    return [];
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isFormatValid(format: StringFormat, value: string): boolean {
    switch (format) {
        case 'uuid': {
            return UUIDUtilities.STRICT_SHAPE.test(value);
        }
        case 'email': {
            return EMAIL_REGEX.test(value);
        }
        case 'phone': {
            return PHONE_REGEX.test(value);
        }
    }
}