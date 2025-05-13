/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseNumberQueryParam } from './parse-number-query-param.function';

describe('parseNumberQueryParam', () => {
    it('parses valid integer string', () => {
        expect(parseNumberQueryParam('123')).toBe(123);
    });

    it('parses valid negative number string', () => {
        expect(parseNumberQueryParam('-456')).toBe(-456);
    });

    it('parses valid float string', () => {
        expect(parseNumberQueryParam('78.9')).toBeCloseTo(78.9);
    });

    it('parses number input directly', () => {
        expect(parseNumberQueryParam(42)).toBe(42);
    });

    it('returns input unchanged for non-numeric string', () => {
        expect(parseNumberQueryParam('abc')).toBe('abc');
    });

    it('returns input unchanged for null', () => {
        expect(parseNumberQueryParam(null)).toBeNull();
    });

    it('returns input unchanged for undefined', () => {
        expect(parseNumberQueryParam(undefined)).toBeUndefined();
    });
});