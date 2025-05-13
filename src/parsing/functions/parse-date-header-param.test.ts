/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseDateHeaderParam } from './parse-date-header-param.function';

describe('parseDateHeaderParam', () => {
    it('returns new Date if input is a valid date', () => {
        const input: Date = new Date('2023-01-01T00:00:00.000Z');
        const result: unknown = parseDateHeaderParam(input);
        expect(result).toEqual(input);
        expect(result).not.toBe(input); // should be a new instance
    });

    it('returns new Date if input is a valid date string', () => {
        const input: string = '2023-01-01T00:00:00.000Z';
        const result: unknown = parseDateHeaderParam(input);
        expect(result).toEqual(new Date(input));
        expect(result).not.toEqual(input);
    });

    it('returns input unchanged if not a date', () => {
        expect(parseDateHeaderParam('not-a-date')).toBe('not-a-date');
    });

    it('returns input unchanged if input is null', () => {
        expect(parseDateHeaderParam(null)).toBeNull();
    });

    it('returns input unchanged if input is a number', () => {
        expect(parseDateHeaderParam(123)).toBe(123);
    });
});