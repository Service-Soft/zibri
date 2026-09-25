import { AllOf, BaseWhereFilter, BaseWhereFilterObject } from './base-where-filter.model';
import { FuzzyLikeFilter } from './fuzzy-like.model';

/**
 * The string where filter object.
 */
type StringWhereFilterObject = BaseWhereFilterObject<string> & {
    /**
     * The property needs to be like the provided string, or like every one of them.
     * @example '%.com'
     * @example ['rent%', '%2026']
     */
    like?: AllOf<string>,
    /**
     * The property needs to be like the provided string, or like every one of them, ignoring case.
     * @example '%.cOm'
     */
    iLike?: AllOf<string>,
    /**
     * The property needs to fuzzily be like the provided string so that eg. Typos don't matter.
     *
     * Several of them are all required, the same way several patterns are.
     */
    fuzzyLike?: AllOf<FuzzyLikeFilter>,
    /**
     * The property needs to sort after the provided string.
     *
     * Which strings sort after which is the application's answer, taken from the default locale of
     * its localize options - the same one an `order` gives, and the one the data source is held to,
     * so a filter and an order over the same property always agree about what after means.
     * @example { name: { after: 'M' } }
     */
    after?: string,
    /**
     * The property needs to sort before the provided string.
     * @example { name: { before: 'M' } }
     */
    before?: string
};

/**
 * A filter for a string where property.
 */
export type StringWhereFilter = BaseWhereFilter<string, StringWhereFilterObject>;