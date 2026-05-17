import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';

/**
 * The string where filter object.
 */
type StringWhereFilterObject = BaseWhereFilterObject<string> & {
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

/**
 * A filter for a string where property.
 */
export type StringWhereFilter = BaseWhereFilter<string, StringWhereFilterObject>;