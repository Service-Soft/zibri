import { describe, expect, it } from '@jest/globals';

import { MaskUtilities } from './mask.utilities';

describe('MaskUtilities.mask', () => {
    it('returns the input unmasked when length is 3', () => {
        expect(MaskUtilities.mask('abc')).toBe('abc');
    });

    it('returns the input unmasked when length is shorter than 3', () => {
        expect(MaskUtilities.mask('ab')).toBe('ab');
        expect(MaskUtilities.mask('a')).toBe('a');
    });

    it('returns the empty string unmasked', () => {
        expect(MaskUtilities.mask('')).toBe('');
    });

    it('masks the middle with a single star for a 4-character string', () => {
        expect(MaskUtilities.mask('abcd')).toBe('a*cd');
    });

    it('keeps the first character and last two characters, masking the rest', () => {
        expect(MaskUtilities.mask('1234567890')).toBe('1*******90');
    });

    it('masks a typical secret-like value correctly', () => {
        expect(MaskUtilities.mask('sk_live_abc123')).toBe(`s${'*'.repeat(11)}23`);
    });
});