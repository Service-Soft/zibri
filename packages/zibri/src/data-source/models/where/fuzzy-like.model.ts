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
 * The value of a parsed fuzzyLike where filter.
 */
export type ParsedFuzzyLikeFilter = Pick<FuzzyLikeFilter, 'value'> & {
    /**
     * The minimum similarity as a ratio between 0 and 1.
     */
    minSimilarityRatio: number
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
 * @returns The search value and the minimum similarity as a ratio between 0 and 1.
 * @throws When the filter is not an object with a "value" property.
 */
export function parseFuzzyLikeFilter(filterValue: unknown): ParsedFuzzyLikeFilter {
    if (typeof filterValue !== 'object' || filterValue === null || !('value' in filterValue)) {
        throw new InternalError('fuzzyLike expects an object with a "value" property');
    }

    const { value, minSimilarity = DEFAULT_MIN_SIMILARITY } = filterValue as FuzzyLikeFilter;
    return { value: String(value), minSimilarityRatio: minSimilarity / 100 };
}