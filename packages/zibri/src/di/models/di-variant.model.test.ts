import { describe, expect, it } from 'vitest';

import { DiVariant } from './di-variant.model.ts';

describe('DiVariant', () => {
    it('constructs successfully with a unique value', () => {
        expect(() => new DiVariant('test-variant-unique-1')).not.toThrow();
    });

    it('throws when constructed with a value that is already in use', () => {

        new DiVariant('test-variant-duplicate');
        expect(() => new DiVariant('test-variant-duplicate')).toThrow(/already exists/);
    });

    it('toString returns the variant value', () => {
        // cspell:disable-next-line
        const variant: DiVariant = new DiVariant('test-variant-tostring');
        // cspell:disable-next-line
        expect(variant.toString()).toBe('test-variant-tostring');
        // oxlint-disable-next-line typescript/restrict-template-expressions cspell:disable-next-line
        expect(`${variant}`).toBe('test-variant-tostring');
    });
});