/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseBooleanQueryParam } from './parse-boolean-query-param.function';

describe('parseBooleanQueryParam', () => {
    it('returns true for string "true"', () => {
        expect(parseBooleanQueryParam('true')).toBe(true);
    });

    it('returns false for string "false"', () => {
        expect(parseBooleanQueryParam('false')).toBe(false);
    });

    it('returns boolean true as-is', () => {
        expect(parseBooleanQueryParam(true)).toBe(true);
    });

    it('returns boolean false as-is', () => {
        expect(parseBooleanQueryParam(false)).toBe(false);
    });

    it('returns other strings unchanged', () => {
        expect(parseBooleanQueryParam('yes')).toBe('yes');
    });

    it('returns non-string, non-boolean values unchanged', () => {
        expect(parseBooleanQueryParam(0)).toBe(0);
        expect(parseBooleanQueryParam(null)).toBeNull();
        expect(parseBooleanQueryParam(undefined)).toBeUndefined();
        expect(parseBooleanQueryParam({})).toEqual({});
    });
});