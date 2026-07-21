/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseBoolean } from './parse-boolean.function';

describe('parseBoolean', () => {
    it('returns true for string "true"', () => {
        expect(parseBoolean('true')).toBe(true);
    });

    it('returns false for string "false"', () => {
        expect(parseBoolean('false')).toBe(false);
    });

    it('returns boolean true as-is', () => {
        expect(parseBoolean(true)).toBe(true);
    });

    it('returns boolean false as-is', () => {
        expect(parseBoolean(false)).toBe(false);
    });

    it('returns other strings unchanged', () => {
        expect(parseBoolean('yes')).toBe('yes');
    });

    it('returns non-string, non-boolean values unchanged', () => {
        expect(parseBoolean(0)).toBe(0);
        expect(parseBoolean(null)).toBeNull();
        expect(parseBoolean(undefined)).toBeUndefined();
        expect(parseBoolean({})).toEqual({});
    });
});