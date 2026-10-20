import { describe, expect, it } from 'vitest';

import { DEFAULT_MIN_SIMILARITY, parseFuzzyLikeFilter } from './fuzzy-like.model.ts';

describe('parseFuzzyLikeFilter', () => {
    it('reads the search value', () => {
        expect(parseFuzzyLikeFilter({ value: 'hello' }).value).toBe('hello');
    });

    it('converts the minimum similarity percentage into a ratio', () => {
        expect(parseFuzzyLikeFilter({ value: 'hello', minSimilarity: 50 }).minSimilarityRatio).toBe(0.5);
        expect(parseFuzzyLikeFilter({ value: 'hello', minSimilarity: 99 }).minSimilarityRatio).toBe(0.99);
        expect(parseFuzzyLikeFilter({ value: 'hello', minSimilarity: 1 }).minSimilarityRatio).toBe(0.01);
    });

    it('falls back to the shared default when no minimum similarity is given', () => {
        // the default is a percentage, so it has to end up as 0.3 and not as 0.003
        expect(DEFAULT_MIN_SIMILARITY).toBe(30);
        expect(parseFuzzyLikeFilter({ value: 'hello' }).minSimilarityRatio).toBe(0.3);
    });

    it('throws when the filter is not an object with a value property', () => {
        expect(() => parseFuzzyLikeFilter('hello')).toThrow(/fuzzyLike expects an object with a "value" property/);
        expect(() => parseFuzzyLikeFilter({ minSimilarity: 30 })).toThrow(/fuzzyLike expects an object with a "value" property/);
        // eslint-disable-next-line unicorn/no-null
        expect(() => parseFuzzyLikeFilter(null)).toThrow(/fuzzyLike expects an object with a "value" property/);
    });
});