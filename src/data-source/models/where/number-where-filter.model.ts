import { BaseWhereFilter } from './base-where-filter.model';

/**
 * A filter for a number where property.
 */
export type NumberWhereFilter = BaseWhereFilter<number> | {
    /**
     * The property needs to be not this value.
     */
    not?: number,
    /**
     * The property needs to be one of the values in the array.
     */
    oneOf?: number[],
    /**
     * The property needs to be NOT one of the values in the array.
     */
    notOneOf?: number[],
    /**
     * The property needs to be greater than the provided value.
     */
    greaterThan?: number,
    /**
     * The property needs to be greater than or equal to the provided value.
     */
    greaterThanEquals?: number,
    /**
     * The property needs to be lesser than the provided value.
     */
    lesserThan?: number,
    /**
     * The property needs to be lesser than or equal to the provided value.
     */
    lesserThanEquals?: number
};