import { BaseWhereFilter } from './base-where-filter.model';

/**
 * A filter for a string where property.
 */
export type StringWhereFilter = BaseWhereFilter<string> | {
    /**
     * The property needs to be not this value.
     */
    not?: string,
    /**
     * The property needs to be one of the values in the array.
     */
    oneOf?: string[],
    /**
     * The property needs to be NOT one of the values in the array.
     */
    notOneOf?: string[],
    /**
     * The property needs to be like the provided string.
     * @example '%.com'
     */
    like?: string,
    /**
     * The property needs to be like the provided string, ignoring case.
     * @example '%.cOm'
     */
    iLike?: string
};