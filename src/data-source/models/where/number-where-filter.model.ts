import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';

/**
 * The number where filter object.
 */
type NumberWhereFilterObject<T extends number | bigint> = BaseWhereFilterObject<T> & {
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
export type NumberWhereFilter<T extends number | bigint> = BaseWhereFilter<T, NumberWhereFilterObject<T>>;