/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseBooleanHeaderParam } from './parse-boolean-header-param.function';

describe('parseBooleanHeaderParam', () => {
    it('returns true for string "true"', () => {
        expect(parseBooleanHeaderParam('true')).toBe(true);
    });

    it('returns false for string "false"', () => {
        expect(parseBooleanHeaderParam('false')).toBe(false);
    });

    it('returns boolean true as-is', () => {
        expect(parseBooleanHeaderParam(true)).toBe(true);
    });

    it('returns boolean false as-is', () => {
        expect(parseBooleanHeaderParam(false)).toBe(false);
    });

    it('returns other strings unchanged', () => {
        expect(parseBooleanHeaderParam('yes')).toBe('yes');
    });

    it('returns non-string, non-boolean values unchanged', () => {
        expect(parseBooleanHeaderParam(0)).toBe(0);
        expect(parseBooleanHeaderParam(null)).toBeNull();
        expect(parseBooleanHeaderParam(undefined)).toBeUndefined();
        expect(parseBooleanHeaderParam({})).toEqual({});
    });
});