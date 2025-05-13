
import { describe, expect, it } from '@jest/globals';

import { parseNumberHeaderParam } from './parse-number-header-param.function';

describe('parseNumberHeaderParam', () => {
    it('parses valid integer string', () => {
        expect(parseNumberHeaderParam('42')).toBe(42);
    });

    it('parses valid negative number string', () => {
        expect(parseNumberHeaderParam('-17')).toBe(-17);
    });

    it('parses valid float string', () => {
        expect(parseNumberHeaderParam('3.14')).toBeCloseTo(3.14);
    });

    it('returns input unchanged for non-numeric string', () => {
        expect(parseNumberHeaderParam('abc')).toBe('abc');
    });

    it('returns input unchanged for empty string', () => {
        expect(parseNumberHeaderParam('')).toBe('');
    });

    it('returns input unchanged for undefined', () => {
        expect(parseNumberHeaderParam(undefined)).toBeUndefined();
    });
});