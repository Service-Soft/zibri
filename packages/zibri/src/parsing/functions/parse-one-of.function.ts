import { parseArray } from './parse-array.function';
import { parseBoolean } from './parse-boolean.function';
import { parseDate } from './parse-date.function';
import { parseNumber } from './parse-number.function';
import { parseObject } from './parse-object.function';
import { parseString } from './parse-string.function';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model';
import { AnyOfShapesMetadata, OneOfPropertyMetadata, OneOfShapeMetadata } from '../../entity/models/one-of-property-metadata.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { shapeProblems } from '../../validation/functions/shape-problems.function';
import { ValidationProblem } from '../../validation/validation-problem.model';

/**
 * A shape a value was tried as and did not fit, with why.
 */
export type ShapeAttempt = {
    /**
     * The shape that was tried.
     */
    shape: OneOfShapeMetadata,
    /**
     * What kept the value from fitting it.
     */
    problems: ValidationProblem[]
};

/**
 * Which of several shapes a value is, or why it is none of them.
 */
export type ShapeChoice = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    fits: true,
    /**
     * The first shape the value fits.
     */
    shape: OneOfShapeMetadata,
    /**
     * The value, parsed as that shape.
     */
    value: unknown
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    fits: false,
    /**
     * Every shape, in the order it was tried, with what kept the value from fitting it.
     */
    attempts: ShapeAttempt[]
};

/**
 * A value that names the shape it is, as it arrives before anything is known about the name.
 */
export type NamedValue = {
    /**
     * The name of the shape.
     */
    shape: string,
    /**
     * The value.
     */
    value?: unknown
};

/**
 * Whether a value is a name and a value and nothing else.
 * @param value - The value.
 * @returns True when it has a text `shape`, maybe a `value`, and no other key.
 */
export function isNamedValue(value: unknown): value is NamedValue {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false;
    }
    return 'shape' in value && typeof value.shape === 'string' && Object.keys(value).every(key => key === 'shape' || key === 'value');
}

/**
 * Parses a value of several named shapes as the shape it names.
 *
 * Only as that shape: a value says which it is, so one that breaks the rules of its shape is left for
 * validation to report rather than read as another.
 * @param rawValue - The value, or json text of it.
 * @param metadata - The shapes it can be.
 * @returns The value with its own value parsed, or the value as it arrived when it names no known shape.
 */
export function parseOneOf(rawValue: unknown, metadata: Pick<OneOfPropertyMetadata, 'shapes'>): unknown {
    let value: unknown = rawValue;
    if (typeof rawValue === 'string') {
        try {
            value = JsonUtilities.parse<unknown>(rawValue);
        }
        catch {
            return rawValue;
        }
    }
    if (!isNamedValue(value)) {
        return rawValue;
    }
    const shape: OneOfShapeMetadata | undefined = metadata.shapes[value.shape];
    if (shape == undefined) {
        return rawValue;
    }
    return { shape: value.shape, value: parseShape(value.value, shape) };
}

/**
 * Chooses which of several shapes a value is: the first, in declaration order, that it parses as and
 * whose rules it then passes.
 *
 * Synchronous on purpose, and judged by the value alone: the one rule that can depend on the request -
 * whether a left out property is required, when a function decides it - takes no part. Validation
 * afterwards checks the chosen shape completely.
 *
 * Each shape is tried on a copy of its own, because parsing converts in place: a shape that fails after
 * turning some text into a number would otherwise hand the number to the next shape.
 * @param value - The value as it arrived.
 * @param metadata - The shapes it can be, in order.
 * @returns The first shape the value fits and the value parsed as it, or every shape with why not.
 */
export function chooseShape(value: unknown, metadata: Pick<AnyOfShapesMetadata, 'shapes'>): ShapeChoice {
    const attempts: ShapeAttempt[] = [];
    for (const shape of metadata.shapes) {
        const parsed: unknown = parseShape(ObjectUtilities.copyDeep(value), shape);
        const problems: ValidationProblem[] = shapeProblems('', parsed, shape);
        if (!problems.length) {
            return { fits: true, shape, value: parsed };
        }
        attempts.push({ shape, problems });
    }
    return { fits: false, attempts };
}

/**
 * Parses a value as the first of several shapes it fits.
 * @param rawValue - The value as it arrived.
 * @param metadata - The shapes it can be, in order.
 * @returns The value parsed as the first shape it fits, or as it arrived when it fits none.
 */
export function parseAnyOf(rawValue: unknown, metadata: Pick<AnyOfShapesMetadata, 'shapes'>): unknown {
    if (rawValue == undefined) {
        return rawValue;
    }
    const choice: ShapeChoice = chooseShape(rawValue, metadata);
    // a value that fits no shape is handed on as it arrived, so that validation reports every shape
    // against what the caller actually sent
    return choice.fits ? choice.value : rawValue;
}

/**
 * Parses a value as the given shape.
 * @param value - The value, which parsing may change.
 * @param shape - The shape to parse it as.
 * @returns The parsed value.
 */
export function parseShape(value: unknown, shape: ArrayPropertyItemMetadata | AnyOfShapesMetadata): unknown {
    switch (shape.type) {
        case 'oneOf': {
            return parseOneOf(value, shape);
        }
        case 'anyOf': {
            return parseAnyOf(value, shape);
        }
        case 'string': {
            return parseString(value);
        }
        case 'number': {
            return parseNumber(value, shape.format);
        }
        case 'boolean': {
            return parseBoolean(value);
        }
        case 'date': {
            return parseDate(value);
        }
        case 'object': {
            return parseObject(value, shape.cls());
        }
        case 'array': {
            return parseArray(value, shape.items);
        }
        case 'file':
        case 'unknown': {
            return value;
        }
    }
}