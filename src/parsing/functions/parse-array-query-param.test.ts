/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseArrayQueryParam } from './parse-array-query-param.function';
import { BadRequestError } from '../../error-handling';
import { ArrayQueryParamMetadata } from '../../routing';

describe('parseArrayQueryParam', () => {
    const meta: ArrayQueryParamMetadata = {
        name: 'foo',
        type: 'array',
        itemType: 'string',
        required: true
    };

    it('returns undefined for undefined input', () => {
        expect(parseArrayQueryParam(undefined, meta)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseArrayQueryParam(null, meta)).toBeNull();
    });

    it('returns value as-is if not a string', () => {
        const input: number = 42;
        expect(parseArrayQueryParam(input, meta)).toBe(input);
    });

    it('parses valid JSON string', () => {
        expect(parseArrayQueryParam('["a", "b"]', meta)).toEqual(['a', 'b']);
    });

    it('throws BadRequestError on invalid JSON', () => {
        expect(() => parseArrayQueryParam('[invalid]', meta)).toThrow(BadRequestError);
    });

    it('uses correct error message', () => {
        try {
            parseArrayQueryParam('[', meta);
        }
        catch (error) {
            expect(error).toBeInstanceOf(BadRequestError);
            expect((error as Error).message).toBe('invalid JSON in query param "foo"');
        }
    });
});