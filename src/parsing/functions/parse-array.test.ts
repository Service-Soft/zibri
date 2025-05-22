/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseArray } from './parse-array.function';
import { BadRequestError } from '../../error-handling';
import { ArrayParamMetadata } from '../../routing';

describe('parseArray', () => {
    const meta: ArrayParamMetadata = {
        name: 'foo',
        type: 'array',
        items: { type: 'string', required: true, primary: false },
        required: true
    };

    it('returns undefined for undefined input', () => {
        expect(parseArray(undefined, meta)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseArray(null, meta)).toBeNull();
    });

    it('returns value as-is if not a string', () => {
        const input: number = 42;
        expect(parseArray(input, meta)).toBe(input);
    });

    it('parses valid JSON string', () => {
        expect(parseArray('["a", "b"]', meta)).toEqual(['a', 'b']);
    });

    it('throws BadRequestError on invalid JSON', () => {
        expect(() => parseArray('[invalid]', meta)).toThrow(BadRequestError);
    });

    it('uses correct error message', () => {
        try {
            parseArray('[', meta);
        }
        catch (error) {
            expect(error).toBeInstanceOf(BadRequestError);
            expect((error as Error).message).toBe('invalid JSON in query param "foo"');
        }
    });
});