import { booleanValueProblems } from './validate-boolean.function.ts';
import { dateValueProblems } from './validate-date.function.ts';
import { fileValueProblems } from './validate-file.function.ts';
import { numberValueProblems } from './validate-number.function.ts';
import { stringValueProblems } from './validate-string.function.ts';
import { PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { ArrayPropertyItemMetadata } from '../../entity/models/array-property-metadata.model.ts';
import { ObjectPropertyMetadata } from '../../entity/models/object-property-metadata.model.ts';
import { OneOfPropertyMetadata, OneOfShapeMetadata } from '../../entity/models/one-of-property-metadata.model.ts';
import { RelationType } from '../../entity/models/relation-type.enum.ts';
import { $ts } from '../../localization/translate.function.ts';
import { File } from '../../parsing/form-data/file.model.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';
import { ObjectUtilities } from '../../utilities/object.utilities.ts';
import { IsRequiredValidationProblem, RelationsNotAllowedValidationProblem, TypeMismatchValidationProblem, UnknownShapeValidationProblem, ValidationProblem } from '../validation-problem.model.ts';

/**
 * The problems of a value as the given shape, judged by the value alone.
 *
 * This is validation without the one thing that can depend on the request: whether a property that
 * was left out is required, when a function decides it. A left out property whose requirement is a
 * function counts as allowed here. Everything else is the same rule validation applies, taken from
 * the same functions - which is what lets the shape a value is chosen as never be one validation
 * then disagrees with about a rule it looks at.
 * @param fullKey - The key the problems are reported under, empty for the value itself.
 * @param value - The value, already parsed as the shape.
 * @param metadata - The shape.
 * @returns All validation problems found.
 */
export function shapeProblems(fullKey: string, value: unknown, metadata: ArrayPropertyItemMetadata): ValidationProblem[] {
    if (value == undefined) {
        return isCertainlyRequired(metadata) ? [new IsRequiredValidationProblem(fullKey)] : [];
    }
    switch (metadata.type) {
        case 'string': {
            return stringValueProblems(fullKey, value, metadata);
        }
        case 'number': {
            return numberValueProblems(fullKey, value, metadata);
        }
        case 'date': {
            return dateValueProblems(fullKey, value, metadata);
        }
        case 'boolean': {
            return booleanValueProblems(fullKey, value);
        }
        case 'file': {
            return fileValueProblems(fullKey, value, metadata);
        }
        case 'unknown': {
            return [];
        }
        case 'object': {
            return objectShapeProblems(fullKey, value, metadata);
        }
        case 'array': {
            if (!Array.isArray(value)) {
                return [new TypeMismatchValidationProblem(fullKey, 'array')];
            }
            return value.flatMap((item, i) => shapeProblems(joinKey(fullKey, String(i)), item, metadata.items));
        }
        case 'oneOf': {
            const named: NamedShape = namedShapeOf(fullKey, value, metadata);
            if (named.shape == undefined) {
                return named.problems;
            }
            return [...named.problems, ...shapeProblems(joinKey(fullKey, 'value'), named.value, named.shape)];
        }
    }
}

/**
 * The shape a value of several named shapes names, or what is wrong with how it names one.
 */
export type NamedShape = {
    /**
     * What is wrong with the value as a name and a value, before its own value is looked at.
     */
    problems: ValidationProblem[],
    /**
     * The shape it names, when it names a known one.
     */
    shape: OneOfShapeMetadata | undefined,
    /**
     * Its own value.
     */
    value: unknown
};

/**
 * Reads which shape a value of several named shapes names.
 * @param fullKey - The key the problems are reported under.
 * @param value - The value, which is not undefined.
 * @param metadata - The shapes it can be.
 * @returns The shape and its value, with what is wrong with the value as a name and a value.
 */
export function namedShapeOf(fullKey: string, value: unknown, metadata: Pick<OneOfPropertyMetadata, 'shapes'>): NamedShape {
    if (typeof value !== 'object' || value === null || Array.isArray(value) || value instanceof Date || value instanceof BigNumber) {
        return { problems: [new TypeMismatchValidationProblem(fullKey, 'object')], shape: undefined, value: undefined };
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const problems: ValidationProblem[] = ObjectUtilities.keys(record)
        .filter(key => key !== 'shape' && key !== 'value')
        .map(key => ({ key: joinKey(fullKey, key), message: $ts`this key is unknown` }));
    const name: unknown = record['shape'];
    const shape: OneOfShapeMetadata | undefined = typeof name === 'string' ? metadata.shapes[name] : undefined;
    if (shape == undefined) {
        problems.push(new UnknownShapeValidationProblem(joinKey(fullKey, 'shape'), ObjectUtilities.keys(metadata.shapes)));
    }
    return { problems, shape, value: record['value'] };
}

/**
 * Whether a left out value is refused no matter who sent it.
 * @param metadata - What the value is declared as.
 * @returns True when the property is required without a function deciding it, and has no default.
 */
function isCertainlyRequired(metadata: ArrayPropertyItemMetadata): boolean {
    if (metadata.required !== true) {
        return false;
    }
    return !('default' in metadata) || metadata.default == undefined;
}

/**
 * The problems of a value as an object of the given class, judged by the value alone.
 * @param fullKey - The key the problems are reported under.
 * @param value - The value.
 * @param metadata - The object shape.
 * @returns All validation problems found.
 */
function objectShapeProblems(fullKey: string, value: unknown, metadata: ObjectPropertyMetadata): ValidationProblem[] {
    if (
        typeof value !== 'object' || value === null || Array.isArray(value)
        || value instanceof Date || value instanceof BigNumber || value instanceof File
    ) {
        return [new TypeMismatchValidationProblem(fullKey, 'object')];
    }
    const record: Record<string, unknown> = value as Record<string, unknown>;
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(metadata.cls());

    const res: ValidationProblem[] = [];
    if (!metadata.allowAdditionalProperties) {
        for (const key of ObjectUtilities.keys(record)) {
            if (!(key in properties)) {
                res.push({ key: joinKey(fullKey, key), message: $ts`this key is unknown` });
            }
        }
    }
    for (const [key, property] of ObjectUtilities.entries(properties)) {
        const child: unknown = record[key];
        switch (property.type) {
            case RelationType.MANY_TO_ONE:
            case RelationType.ONE_TO_MANY:
            case RelationType.HAS_ONE:
            case RelationType.BELONGS_TO_ONE:
            case RelationType.MANY_TO_MANY: {
                if (child != undefined) {
                    res.push(new RelationsNotAllowedValidationProblem(joinKey(fullKey, key), property, key));
                }
                break;
            }
            case 'string':
            case 'number':
            case 'date':
            case 'boolean':
            case 'file':
            case 'unknown':
            case 'object':
            case 'array':
            case 'oneOf': {
                res.push(...shapeProblems(joinKey(fullKey, key), child, property));
                break;
            }
        }
    }
    return res;
}

// eslint-disable-next-line jsdoc-js/require-jsdoc
function joinKey(parentKey: string, key: string): string {
    return parentKey ? `${parentKey}.${key}` : key;
}