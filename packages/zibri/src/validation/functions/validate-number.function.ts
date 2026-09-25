import assert from 'node:assert';

import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { AnyNumber } from '../../data-source/models/where/number-where-filter.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { NumberFormat, NumberPropertyMetadata } from '../../entity/models/number-property-metadata.model';
import { $ts } from '../../localization/translate.function';
import { INTEGER_REGEX } from '../../parsing/functions/parse-number.function';
import { QueryParamMetadata, HeaderParamMetadata, PathParamMetadata } from '../../routing/decorators/param.decorator';
import { NumberParamMetadata } from '../../routing/models/number-param-metadata.model';
import { BigNumber } from '../../utilities/number.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { IsRequiredValidationProblem, TypeMismatchValidationProblem, ValidationProblem } from '../validation-problem.model';

/**
 * Validates the given number property.
 * @param key - The key of the property.
 * @param property - The actual value.
 * @param metadata - The metadata of the property.
 * @param parentKey - The key of the parent, if it exists.
 * @param entity - The entity that this value belongs to.
 * @returns All validation problems found.
 */
export async function validateNumber(
    key: string,
    property: unknown,
    metadata: PropertyMetadata | QueryParamMetadata | HeaderParamMetadata | PathParamMetadata,
    parentKey: string | undefined,
    entity: unknown | undefined
): Promise<ValidationProblem[]> {
    const meta: NumberPropertyMetadata | NumberParamMetadata = metadata as NumberPropertyMetadata | NumberParamMetadata;
    const fullKey: string = parentKey ? `${parentKey}.${key}` : key;
    if (property == undefined) {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const isRequired: boolean = typeof metadata.required === 'boolean' ? metadata.required : await metadata.required(entity, context);
        if ((meta as NumberPropertyMetadata).default == undefined && isRequired) {
            return [new IsRequiredValidationProblem(fullKey)];
        }
        if (!isRequired || (meta as NumberPropertyMetadata).default != undefined) {
            return [];
        }
    }
    return numberValueProblems(fullKey, property, meta);
}

/**
 * The problems of a number value, judged by the value alone.
 *
 * Everything about a number except whether it may be left out, which can depend on the request.
 * What decides which of several shapes a value is uses exactly this, so it cannot disagree with
 * validation about any rule it looks at.
 * @param fullKey - The key the problems are reported under.
 * @param property - The value.
 * @param meta - What the number is declared as.
 * @returns All validation problems found.
 */
export function numberValueProblems(
    fullKey: string,
    property: unknown,
    meta: NumberPropertyMetadata | NumberParamMetadata
): ValidationProblem[] {
    // the format says which type the value is, and nothing else can: a `bigint` and an exact
    // decimal are both written as text, so what arrived says nothing about what was meant. This is
    // also where a property whose declared type contradicts its format is caught - the check at
    // declaration time can only read a type typescript emits, and a union like `number | null` is
    // not one of them
    const expectedType: string = expectedTypeFor(meta.format);
    if (runtimeTypeOf(property) !== expectedType) {
        return [new TypeMismatchValidationProblem(fullKey, expectedType)];
    }

    assert(typeof property === 'bigint' || typeof property === 'number' || property instanceof BigNumber);

    if (!isFormatValid(meta.format, property)) {
        return [{ key: fullKey, message: $ts`needs to be in format "${meta.format}"` }];
    }
    // through a comparable form rather than the value itself, because a BigNumber compares by
    // reference against a plain number - it would match no enum member and pass any bound
    if (meta.enum && !ObjectUtilities.values(meta.enum).includes(comparableValueOf(property))) {
        return [{ key: fullKey, message: $ts`needs to match one of "${ObjectUtilities.values(meta.enum)}"` }];
    }
    if (meta.min != undefined && comparableValueOf(property) < meta.min) {
        return [{ key: fullKey, message: $ts`needs to be at least ${meta.min}` }];
    }
    if (meta.max != undefined && comparableValueOf(property) > meta.max) {
        return [{ key: fullKey, message: $ts`needs to be at most ${meta.max}` }];
    }
    return [];
}

/**
 * What a value of the given format is at runtime.
 * @param format - What kind of number the property holds.
 * @returns The name of the type a value of it has, as a caller would recognize it.
 */
function expectedTypeFor(format: NumberFormat): string {
    switch (format) {
        case 'bigint': {
            return 'bigint';
        }
        case 'bignumber': {
            return 'BigNumber';
        }
        case 'integer':
        case 'number': {
            return 'number';
        }
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
function runtimeTypeOf(value: unknown): string {
    return value instanceof BigNumber ? 'BigNumber' : typeof value;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function comparableValueOf(value: AnyNumber): number | bigint {
    return value instanceof BigNumber ? value.toNumber() : value;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isFormatValid(format: NumberFormat, value: AnyNumber): boolean {
    switch (format) {
        case 'bigint': {
            return INTEGER_REGEX.test(value.toString());
        }
        case 'integer': {
            return Number.isInteger(value);
        }
        // any number is one of these: a double is what a javascript number is, and a BigNumber
        // holds whatever it was given. The type check above is the whole of what they require
        case 'bignumber':
        case 'number': {
            return true;
        }
    }
}