import { InternalError } from '../../../error-handling/internal-error.model';
import { ExcludeStrict } from '../../../types/exclude-strict.type';
import { Percentage } from '../../../types/percentage.type';

/**
 * The minimum similarity that a fuzzyLike filter requires, as a percentage between 1 and 99.
 *
 * 1 matches almost everything while 99 is basically just a strict equal.
 */
export type MinSimilarity = ExcludeStrict<Percentage, 0 | 100>;

/**
 * The value of a fuzzyLike where filter.
 */
export type FuzzyLikeFilter = {
    /**
     * The search value.
     */
    value: string,
    /**
     * The minimum similarity that the search term must have as a percentage between 1 and 99.
     *
     * 1 matches almost everything while 99 is basically just a strict equal.
     */
    minSimilarity?: MinSimilarity
};

/**
 * A similarity compared with the similarity of another text to the same search, rather than with a
 * fixed minimum.
 *
 * What a walk ordered by similarity continues by: a row past another one is less similar to the
 * search than that row's text is, and a row level with it is exactly as similar. Comparing two
 * similarities the same store calculated keeps that exact, where a similarity carried as a number
 * would have to be calculated identically everywhere it is compared.
 */
export type SimilarityBound = {
    /**
     * The text whose similarity to the search is the bound.
     */
    text: string,
    /**
     * Whether the value has to be less similar than that text, or exactly as similar.
     */
    comparison: 'lesser' | 'equal'
};

/**
 * The value of a fuzzyLike where filter that compares with a bound rather than a minimum.
 *
 * Written by a walk that continues past a cursor, never by a caller: the filter a caller writes is
 * FuzzyLikeFilter.
 */
export type BoundedFuzzyLikeFilter = Pick<FuzzyLikeFilter, 'value'> & {
    /**
     * What the similarity is compared with.
     */
    bound: SimilarityBound
};

/**
 * The value of a parsed fuzzyLike where filter.
 */
export type ParsedFuzzyLikeFilter = Pick<FuzzyLikeFilter, 'value'> & {
    /**
     * The minimum similarity as a ratio between 0 and 1.
     */
    minSimilarityRatio: number,
    /**
     * What the similarity is compared with instead of the minimum, when the filter names a bound.
     */
    bound: SimilarityBound | undefined
};

/**
 * The minimum similarity that is used when a fuzzyLike filter does not provide one.
 *
 * Every implementation of a fuzzy search needs to use this, so that the same filter behaves the
 * same way no matter which data source it runs against.
 */
export const DEFAULT_MIN_SIMILARITY: MinSimilarity = 30;

/**
 * Reads the value and the minimum similarity of a fuzzyLike filter.
 *
 * The minimum similarity is a percentage on the filter itself, but every implementation needs it as
 * a ratio between 0 and 1, so it is converted here instead of in each of them.
 * @param filterValue - The raw value of the fuzzyLike filter.
 * @returns The search value, the minimum similarity as a ratio between 0 and 1, and the bound the
 * filter compares with instead, if it names one.
 * @throws When the filter is not an object with a "value" property, or names a bound that is not one.
 */
export function parseFuzzyLikeFilter(filterValue: unknown): ParsedFuzzyLikeFilter {
    if (typeof filterValue !== 'object' || filterValue === null || !('value' in filterValue)) {
        throw new InternalError('fuzzyLike expects an object with a "value" property');
    }

    const { value, minSimilarity = DEFAULT_MIN_SIMILARITY } = filterValue as FuzzyLikeFilter;
    return { value: String(value), minSimilarityRatio: minSimilarity / 100, bound: findSimilarityBound(filterValue) };
}

/**
 * Reads the bound a fuzzyLike filter compares with, when it names one.
 * @param filterValue - The raw value of the fuzzyLike filter.
 * @returns The bound, or undefined when the filter compares with a minimum.
 * @throws When the filter names a bound that is not one.
 */
function findSimilarityBound(filterValue: object): SimilarityBound | undefined {
    if (!('bound' in filterValue) || filterValue.bound == undefined) {
        return undefined;
    }
    const bound: unknown = filterValue.bound;
    if (
        typeof bound !== 'object' || bound === null
        || !('text' in bound) || typeof bound.text !== 'string'
        || !('comparison' in bound) || (bound.comparison !== 'lesser' && bound.comparison !== 'equal')
    ) {
        throw new InternalError('The bound of a fuzzyLike filter needs a "text" and a "comparison" of "lesser" or "equal".');
    }
    return { text: bound.text, comparison: bound.comparison };
}