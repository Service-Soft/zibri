import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model.ts';
import { BigNumber } from '../../../utilities/number.utilities.ts';

/**
 * Every shape a number takes, for a property that holds all of them.
 *
 * A filter compares rather than stores, so what it may name is decided by what the property's own
 * shape holds exactly rather than by what the property is declared as. An exact decimal holds every
 * javascript number and every bigint, so a bound on one may be written as any of the three - which
 * is what keeps `{ greaterThanEquals: 0 }` from having to be `new BigNumber(0)` every time. It does
 * not go the other way: a bigint and an exact decimal both hold values a double does not, so a
 * filter naming one of those against a plain number property would be asking a question the column
 * cannot answer.
 */
export type AnyNumber = number | bigint | BigNumber;

/**
 * The number where filter object.
 */
type NumberWhereFilterObject<T extends AnyNumber> = BaseWhereFilterObject<T> & {
    /**
     * The property needs to be greater than the provided value.
     */
    greaterThan?: T,
    /**
     * The property needs to be greater than or equal to the provided value.
     */
    greaterThanEquals?: T,
    /**
     * The property needs to be lesser than the provided value.
     */
    lesserThan?: T,
    /**
     * The property needs to be lesser than or equal to the provided value.
     */
    lesserThanEquals?: T
};

/**
 * A filter for a number where property.
 */
export type NumberWhereFilter<T extends AnyNumber> = BaseWhereFilter<T, NumberWhereFilterObject<T>>;