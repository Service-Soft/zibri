
import { ArrayWhereFilter, ObjectArrayWhereFilter } from './array-where-filter.model';
import { BooleanWhereFilter } from './boolean-where-filter.model';
import { DateWhereFilter } from './date-where-filter.model';
import { NumberWhereFilter } from './number-where-filter.model';
import { ObjectWhereFilter } from './object-where-filter.model';
import { StringWhereFilter } from './string-where-filter.model';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { ObjectUtilities } from '../../../utilities/object.utilities';

/**
 * Where filter keys of object properties.
 */
type ObjectWhereFilterKeys = keyof ObjectWhereFilter<object>;

/**
 * Where filter keys of array properties.
 */
type ArrayWhereFilterKeys = keyof ExcludeStrict<ArrayWhereFilter<object>, null | object[]>;

/**
 * Where filter keys of object array properties.
 */
type ObjectArrayWhereFilterKeys = keyof ExcludeStrict<ObjectArrayWhereFilter<object>, null | object[]>;

/**
 * Where filter keys of boolean properties.
 */
type BooleanWhereFilterKeys = keyof BooleanWhereFilter;

/**
 * Where filter keys of date properties.
 */
type DateWhereFilterKeys = keyof ExcludeStrict<DateWhereFilter, null | Date>;

/**
 * Where filter keys of number properties.
 */
type NumberWhereFilterKeys = keyof ExcludeStrict<NumberWhereFilter<number | bigint>, null | (number | bigint)>;

/**
 * Where filter keys of string properties.
 */
type StringWhereFilterKeys = keyof ExcludeStrict<StringWhereFilter, null | string>;

/**
 * All where filter keys.
 */
export type WhereFilterKeys = ArrayWhereFilterKeys
    | ObjectArrayWhereFilterKeys
    | BooleanWhereFilterKeys
    | DateWhereFilterKeys
    | NumberWhereFilterKeys
    | ObjectWhereFilterKeys
    | StringWhereFilterKeys;

const whereFilterKeysRecord: Record<WhereFilterKeys, WhereFilterKeys> = {
    not: 'not',
    like: 'like',
    oneOf: 'oneOf',
    notOneOf: 'notOneOf',
    after: 'after',
    afterOrOn: 'afterOrOn',
    before: 'before',
    beforeOrOn: 'beforeOrOn',
    greaterThan: 'greaterThan',
    greaterThanEquals: 'greaterThanEquals',
    lesserThan: 'lesserThan',
    lesserThanEquals: 'lesserThanEquals',
    iLike: 'iLike',
    fuzzyLike: 'fuzzyLike',
    is: 'is',
    where: 'where',
    includes: 'includes',
    isIncludedIn: 'isIncludedIn',
    length: 'length',
    lengthGreaterThan: 'lengthGreaterThan',
    lengthLesserThanEquals: 'lengthLesserThanEquals',
    lengthGreaterThanEquals: 'lengthGreaterThanEquals',
    lengthLesserThan: 'lengthLesserThan'
};
const whereFilterKeySet: Set<WhereFilterKeys> = new Set<WhereFilterKeys>(ObjectUtilities.values(whereFilterKeysRecord));

// eslint-disable-next-line jsdoc/require-returns
/**
 * Checks if the given key is a where filter key.
 * @param key - The key to check.
 */
export function isWhereFilterKey(key: unknown): key is WhereFilterKeys {
    return whereFilterKeySet.has(key as WhereFilterKeys);
}