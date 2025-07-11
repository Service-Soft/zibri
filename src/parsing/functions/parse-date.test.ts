/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseDate } from './parse-date.function';

describe('parseDate', () => {
    it('returns new Date if input is a valid Date object', () => {
        const input: Date = new Date('2023-01-01T00:00:00.000Z');
        const result: unknown = parseDate(input);
        expect(result).toEqual(input);
        expect(result).not.toBe(input);
    });

    it('returns new Date if input is a valid date string', () => {
        const input: string = '2023-01-01T00:00:00.000Z';
        const result: unknown = parseDate(input);
        expect(result).toEqual(new Date(input));
        expect(result).not.toEqual(input);
    });

    it('returns input unchanged if not a valid date', () => {
        expect(parseDate('invalid-date')).toBe('invalid-date');
    });

    it('returns input unchanged if null', () => {
        expect(parseDate(null)).toBeNull();
    });

    it('returns input unchanged if a number', () => {
        expect(parseDate(1234567890)).toBe(1234567890);
    });
});