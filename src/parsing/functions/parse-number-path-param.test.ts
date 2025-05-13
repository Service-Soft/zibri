
import { describe, expect, it } from '@jest/globals';

import { parseNumberPathParam } from './parse-number-path-param.function';

describe('parseNumberPathParam', () => {
    it('parses valid integer string', () => {
        expect(parseNumberPathParam('123')).toBe(123);
    });

    it('parses valid negative number string', () => {
        expect(parseNumberPathParam('-456')).toBe(-456);
    });

    it('parses valid float string', () => {
        expect(parseNumberPathParam('78.9')).toBeCloseTo(78.9);
    });

    it('returns input unchanged for non-numeric string', () => {
        expect(parseNumberPathParam('abc')).toBe('abc');
    });

    it('returns input unchanged for empty string', () => {
        expect(parseNumberPathParam('')).toBe('');
    });

    it('returns input unchanged for undefined', () => {
        expect(parseNumberPathParam(undefined)).toBeUndefined();
    });
});