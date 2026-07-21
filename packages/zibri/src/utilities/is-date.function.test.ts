import { describe, expect, it } from '@jest/globals';

import { isDate } from './is-date.function';

describe('isDate', () => {
    it('returns true for a Date instance', () => {
        expect(isDate(new Date())).toBe(true);
    });

    it('returns true for a plain date string', () => {
        expect(isDate('2024-01-01')).toBe(true);
    });

    it('returns true for a full ISO datetime string with milliseconds and timezone', () => {
        expect(isDate('2024-01-01T12:30:00.000Z')).toBe(true);
    });

    it('returns true for a datetime string without seconds/milliseconds', () => {
        expect(isDate('2024-01-01T12:30')).toBe(true);
    });

    it('returns false for a non-date string', () => {
        expect(isDate('not a date')).toBe(false);
    });

    it('returns false for a string with the wrong format even if Date can parse it', () => {
        expect(isDate('01/01/2024')).toBe(false);
    });

    it('returns false for a non-string, non-Date value', () => {
        expect(isDate(42)).toBe(false);
        expect(isDate({})).toBe(false);
        expect(isDate(undefined)).toBe(false);
        // eslint-disable-next-line unicorn/no-null
        expect(isDate(null)).toBe(false);
    });
});