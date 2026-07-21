import { BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Percentage } from '../../../types/percentage.type';

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
    iLike?: string,
    /**
     * The property needs to fuzzily be like the provided string so that eg. Typos don't matter.
     */
    fuzzyLike?: {
        /**
         * The search value.
         */
        value: string,
        /**
         * The minimum similarity that the search term must have as a percentage between 1 and 99.
         *
         * 1 matches almost everything while 99 is basically just a strict equal.
         */
        minSimilarity?: ExcludeStrict<Percentage, 0 | 100>
    }
};

/**
 * A filter for a string where property.
 */
export type StringWhereFilter = BaseWhereFilter<string, StringWhereFilterObject>;