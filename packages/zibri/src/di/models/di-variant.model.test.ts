import { describe, expect, it } from '@jest/globals';

import { DiVariant } from './di-variant.model';

describe('DiVariant', () => {
    it('constructs successfully with a unique value', () => {
        expect(() => new DiVariant('test-variant-unique-1')).not.toThrow();
    });

    it('throws when constructed with a value that is already in use', () => {

        new DiVariant('test-variant-duplicate');
        expect(() => new DiVariant('test-variant-duplicate')).toThrow(/already exists/);
    });

    it('toString returns the variant value', () => {
        // eslint-disable-next-line cspell/spellchecker
        const variant: DiVariant = new DiVariant('test-variant-tostring');
        // eslint-disable-next-line cspell/spellchecker
        expect(variant.toString()).toBe('test-variant-tostring');
        // eslint-disable-next-line cspell/spellchecker
        expect(`${variant}`).toBe('test-variant-tostring');
    });
});