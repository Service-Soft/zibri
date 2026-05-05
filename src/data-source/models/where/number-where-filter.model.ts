import { BaseWhereFilter } from './base-where-filter.model';

/**
 * A filter for a number where property.
 */
export type NumberWhereFilter<T extends number | bigint> = BaseWhereFilter<T> | {
    /**
     * The property needs to be not this value.
     */
    not?: T,
    /**
     * The property needs to be one of the values in the array.
     */
    oneOf?: T[],
    /**
     * The property needs to be NOT one of the values in the array.
     */
    notOneOf?: T[],
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