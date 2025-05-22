/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseNumber } from './parse-number.function';

describe('parseNumber', () => {
    it('parses valid integer string', () => {
        expect(parseNumber('123')).toBe(123);
    });

    it('parses valid negative number string', () => {
        expect(parseNumber('-456')).toBe(-456);
    });

    it('parses valid float string', () => {
        expect(parseNumber('78.9')).toBeCloseTo(78.9);
    });

    it('parses number input directly', () => {
        expect(parseNumber(42)).toBe(42);
    });

    it('returns input unchanged for non-numeric string', () => {
        expect(parseNumber('abc')).toBe('abc');
    });

    it('returns input unchanged for null', () => {
        expect(parseNumber(null)).toBeNull();
    });

    it('returns input unchanged for undefined', () => {
        expect(parseNumber(undefined)).toBeUndefined();
    });
});