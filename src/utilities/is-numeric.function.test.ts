import { describe, expect, it } from '@jest/globals';

import { isNumeric } from './is-numeric.function';

describe('isNumeric', () => {
    it('returns true for a plain number', () => {
        expect(isNumeric(42)).toBe(true);
    });

    it('returns true for a negative number', () => {
        expect(isNumeric(-42)).toBe(true);
    });

    it('returns true for a decimal number', () => {
        expect(isNumeric(1.5)).toBe(true);
    });

    it('returns false for NaN, even though typeof NaN === "number"', () => {
        expect(isNumeric(Number.NaN)).toBe(false);
    });

    it('returns true for the numeric string "0"', () => {
        expect(isNumeric('0')).toBe(true);
    });

    it('returns false for a string with a leading zero like "007"', () => {
        expect(isNumeric('007')).toBe(false);
    });

    it('returns true for a negative numeric string', () => {
        expect(isNumeric('-0')).toBe(true);
    });

    it('returns true for a decimal numeric string', () => {
        expect(isNumeric('1.5')).toBe(true);
    });

    it('returns false for a numeric string with a trailing dot', () => {
        expect(isNumeric('1.')).toBe(false);
    });

    it('returns false for a numeric string with a leading dot', () => {
        expect(isNumeric('.5')).toBe(false);
    });

    it('returns false for scientific notation', () => {
        expect(isNumeric('1e5')).toBe(false);
    });

    it('returns false for an empty string', () => {
        expect(isNumeric('')).toBe(false);
    });

    it('returns false for non-numeric, non-string values', () => {
        // eslint-disable-next-line unicorn/no-null
        expect(isNumeric(null)).toBe(false);
        expect(isNumeric(undefined)).toBe(false);
        expect(isNumeric({})).toBe(false);
        expect(isNumeric([])).toBe(false);
        expect(isNumeric(true)).toBe(false);
    });
});