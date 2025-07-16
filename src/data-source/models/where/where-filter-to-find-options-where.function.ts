import { FindOptionsWhere as ToFindOptionsWhere, FindOptionsWhereProperty as ToFindOptionsWhereProperty, Or, FindOperator, Equal, IsNull, Not, And, Like, In, MoreThan, LessThan, MoreThanOrEqual, LessThanOrEqual, ILike, ArrayContains, ArrayContainedBy, Raw } from 'typeorm';

import { ArrayWhereFilter } from './array-where-filter.model';
import { BaseWhereFilter } from './base-where-filter.model';
import { DateWhereFilter } from './date-where-filter.model';
import { NumberWhereFilter } from './number-where-filter.model';
import { ObjectWhereFilter } from './object-where-filter.model';
import { StringWhereFilter } from './string-where-filter.model';
import { WhereFilter, Where, WhereFilterProperty } from './where-filter.model';
import { BaseEntity, ManyToOnePropertyMetadata, ObjectPropertyMetadata, OneToOnePropertyMetadata, PropertyMetadata, Relation } from '../../../entity';
import { ExcludeStrict, Newable } from '../../../types';
import { MetadataUtilities } from '../../../utilities';

/**
 * Transforms the given Zibri where filter to typeorm's FindOptionsWhere.
 * @param filter - The filter to transform.
 * @param entityClass - The entity class that the where filter is for.
 * @returns Typeorm's FindOptionsWhere.
 */
export function whereFilterToFindOptionsWhere<T extends object>(
    filter: Where<T>,
    entityClass: Newable<T>
): Where<T> extends WhereFilter<T>[] ? ToFindOptionsWhere<T>[] : ToFindOptionsWhere<T> {
    const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
    if (Array.isArray(filter)) {
        const values: ToFindOptionsWhere<T>[] = [];
        for (const f of filter) {
            values.push(singleWhereFilterToFindOptionsWhere(f, properties));
        }
        return values as Where<T> extends WhereFilter<T>[] ? ToFindOptionsWhere<T>[] : ToFindOptionsWhere<T>;
    }
    // eslint-disable-next-line stylistic/max-len
    return singleWhereFilterToFindOptionsWhere(filter, properties) as Where<T> extends WhereFilter<T>[] ? ToFindOptionsWhere<T>[] : ToFindOptionsWhere<T>;
}

/**
 * Transforms a single Zibri where filter to typeorm FindOptionsWhere.
 * @param filter - The filter to transform.
 * @param properties - The properties of the entity that the filter is for.
 * @returns Typeorm FindOptionsWhere.
 */
function singleWhereFilterToFindOptionsWhere<T extends Object>(
    filter: WhereFilter<T>,
    properties: Record<string, PropertyMetadata>
): ToFindOptionsWhere<T> {
    const res: ToFindOptionsWhere<T> = {};
    for (const key of Object.keys(filter) as (keyof WhereFilter<T>)[]) {
        const prop: WhereFilterProperty<T[typeof key]> | WhereFilterProperty<T[typeof key]>[] | undefined = filter[key];
        if (prop === undefined) {
            continue;
        }

        const propertyMetadata: PropertyMetadata = properties[key];
        switch (propertyMetadata.type) {
            case 'object': {
                properties = MetadataUtilities.getModelProperties(propertyMetadata.cls());
                break;
            }
            case Relation.ONE_TO_ONE:
            case Relation.MANY_TO_ONE: {
                properties = MetadataUtilities.getModelProperties(propertyMetadata.target());
                break;
            }
            case 'string':
            case 'number':
            case 'boolean':
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_MANY:
            case 'array':
            case 'date':
            case 'file':
            default: {
                break;
            }
        }
        res[key] = propertyToFindOperator(
            prop,
            propertyMetadata
        ) as typeof key extends 'toString' ? unknown : ToFindOptionsWhereProperty<NonNullable<T[typeof key]>>;
    }
    return res;
}

/**
 * Transforms a property filter or multiple property filters to a typeorm FindOperator.
 * @param property - The property filter to transform.
 * @param propertyMetadata - The metadata of the property.
 * @returns The typeorm FindOperator.
 */
function propertyToFindOperator<T>(
    property: WhereFilterProperty<T> | WhereFilterProperty<T>[],
    propertyMetadata: PropertyMetadata
): FindOperator<T> {
    if (Array.isArray(property)) {
        return Or(...property.map(p => singlePropertyToFindOperator(p, propertyMetadata)));
    }
    return singlePropertyToFindOperator(property, propertyMetadata);
}

/**
 * Where filter keys of object properties.
 */
type ObjectWhereFilterKeys = (
    keyof ExcludeStrict<
        ObjectWhereFilter<object>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        null | { equals: object } | { where: Where<object> }
    >
) | 'equals' | 'where';

/**
 * Where filter keys of array properties.
 */
type ArrayWhereFilterKeys = (
    keyof ExcludeStrict<
        ArrayWhereFilter<object>,
        // eslint-disable-next-line jsdoc/require-jsdoc
        null | { equals: object[] }
    >
) | 'equals';

/**
 * All where filter keys.
 */
type WhereFilterKeys = ArrayWhereFilterKeys
    | keyof ExcludeStrict<DateWhereFilter, BaseWhereFilter<Date>>
    | keyof ExcludeStrict<NumberWhereFilter, BaseWhereFilter<number>>
    | ObjectWhereFilterKeys
    | keyof ExcludeStrict<StringWhereFilter, BaseWhereFilter<string>>;

const whereFilterKeysRecord: Record<WhereFilterKeys, WhereFilterKeys> = {
    not: 'not',
    like: 'like',
    oneOf: 'oneOf',
    notOneOf: 'notOneOf',
    after: 'after',
    before: 'before',
    greaterThan: 'greaterThan',
    greaterThanEquals: 'greaterThanEquals',
    lesserThan: 'lesserThan',
    lesserThanEquals: 'lesserThanEquals',
    iLike: 'iLike',
    equals: 'equals',
    where: 'where',
    includes: 'includes',
    isIncludedIn: 'isIncludedIn'
};

const whereFilterKeys: WhereFilterKeys[] = Object.values(whereFilterKeysRecord);

/**
 * Transforms a single where filter property to a typeorm FindOperator.
 * @param property - The where filter property to transform.
 * @param propertyMetadata - The metadata of the where filter property.
 * @returns A typeorm FindOperator.
 * @throws When the where filter property is invalid.
 */
// eslint-disable-next-line sonar/cognitive-complexity
function singlePropertyToFindOperator<T>(
    property: WhereFilterProperty<T>,
    propertyMetadata: PropertyMetadata
): FindOperator<T> {
    if (property === null) {
        // eslint-disable-next-line typescript/no-unsafe-return
        return IsNull();
    }
    if (
        typeof property === 'string'
        || typeof property === 'number'
        || typeof property === 'boolean'
        || property instanceof Date
    ) {
        return Equal(property as T);
    }

    const operators: FindOperator<unknown>[] = [];
    const filterKeys: (keyof WhereFilterProperty<T>)[] = Object.keys(property) as (keyof WhereFilterProperty<T>)[];
    if (!filterKeys.length) {
        throw new Error('Empty where filter');
    }
    for (const key of filterKeys) {
        if (!isWhereFilterKey(key)) {
            throw new Error(`Unknown key "${key.toString()}" on where filer ${property}`);
        }
        const value: unknown = (property as Record<WhereFilterKeys, unknown>)[key];

        switch (key) {
            case 'not': {
                operators.push(Not(value));
                break;
            }
            case 'like': {
                operators.push(Like(value));
                break;
            }
            case 'oneOf': {
                if (!Array.isArray(value)) {
                    throw new Error(`The "oneOf" property of the where filter ${property} needs to be an array.`);
                }
                operators.push(In(value));
                break;
            }
            case 'notOneOf': {
                if (!Array.isArray(value)) {
                    throw new Error(`The "notOneOf" property of the where filter ${property} needs to be an array.`);
                }
                operators.push(Not(In(value)));
                break;
            }
            case 'after': {
                operators.push(MoreThan(value));
                break;
            }
            case 'before': {
                operators.push(LessThan(value));
                break;
            }
            case 'greaterThan': {
                operators.push(MoreThan(value));
                break;
            }
            case 'greaterThanEquals': {
                operators.push(MoreThanOrEqual(value));
                break;
            }
            case 'lesserThan': {
                operators.push(LessThan(value));
                break;
            }
            case 'lesserThanEquals': {
                operators.push(LessThanOrEqual(value));
                break;
            }
            case 'iLike': {
                operators.push(ILike(value));
                break;
            }
            case 'equals': {
                operators.push(Equal(value));
                break;
            }
            case 'where': {
                // eslint-disable-next-line jsdoc/require-jsdoc
                const whereFilter: { where: Where<Record<string, unknown>> } = property as { where: Where<Record<string, unknown>> };
                const isJson: boolean = propertyMetadata.type === 'object';
                if (isJson) {
                    const nestedLiteral: ToFindOptionsWhere<Record<string, unknown>> = whereFilterToFindOptionsWhere(
                        whereFilter.where,
                        (propertyMetadata as ObjectPropertyMetadata).cls() as Newable<object>
                    );
                    return Raw<T>(
                        alias => `${alias} @> :json`,
                        { json: nestedLiteral }
                    ) as FindOperator<T>;
                }
                return whereFilterToFindOptionsWhere(
                    whereFilter.where,
                    (propertyMetadata as OneToOnePropertyMetadata<BaseEntity> | ManyToOnePropertyMetadata<BaseEntity>).target()
                ) as unknown as FindOperator<T>;
            }
            case 'includes': {
                if (!Array.isArray(value)) {
                    throw new Error(`The "includes" property of the where filter ${property} needs to be an array.`);
                }
                operators.push(ArrayContains(value));
                break;
            }
            case 'isIncludedIn': {
                if (!Array.isArray(value)) {
                    throw new Error(`The "isIncludedIn" property of the where filter ${property} needs to be an array.`);
                }
                operators.push(ArrayContainedBy(value));
                break;
            }
        }
    }

    if (operators.length === 1) {
        return operators[0] as FindOperator<T>;
    }

    return And(...operators) as FindOperator<T>;
}

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given key is a where filter key.
 * @param key - The key to check.
 */
function isWhereFilterKey(key: unknown): key is WhereFilterKeys {
    return whereFilterKeys.includes(key as WhereFilterKeys);
}