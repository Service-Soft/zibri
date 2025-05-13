/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseObjectQueryParam } from './parse-object-query-param.function';
import { BadRequestError } from '../../error-handling';
import { ObjectQueryParamMetadata } from '../../routing';

describe('parseObjectQueryParam', () => {
    const meta: ObjectQueryParamMetadata = {
        name: 'myObject',
        type: 'object',
        required: true,
        cls: class Dummy {}
    };

    it('returns undefined for undefined input', () => {
        expect(parseObjectQueryParam(undefined, meta)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseObjectQueryParam(null, meta)).toBeNull();
    });

    it('returns input unchanged if not a string', () => {
        const input: object = { foo: 'bar' };
        expect(parseObjectQueryParam(input, meta)).toBe(input);
    });

    it('parses valid JSON object string', () => {
        const json: string = '{"a": 1, "b": "test"}';
        expect(parseObjectQueryParam(json, meta)).toEqual({ a: 1, b: 'test' });
    });

    it('parses valid nested object', () => {
        const json: string = '{"x": {"y": [1, 2, 3]}}';
        expect(parseObjectQueryParam(json, meta)).toEqual({ x: { y: [1, 2, 3] } });
    });

    it('parses empty JSON object', () => {
        expect(parseObjectQueryParam('{}', meta)).toEqual({});
    });

    it('throws BadRequestError for invalid JSON', () => {
        expect(() => parseObjectQueryParam('{invalid}', meta)).toThrow(BadRequestError);
    });

    it('throws BadRequestError with correct message', () => {
        try {
            parseObjectQueryParam('[', meta);
        }
        catch (error) {
            expect(error).toBeInstanceOf(BadRequestError);
            expect((error as Error).message).toBe('invalid JSON in query param "myObject"');
        }
    });

    it('parses valid array JSON string (edge case)', () => {
        // Should still parse since it's valid JSON even if semantically not an object
        expect(parseObjectQueryParam('[1,2]', meta)).toEqual([1, 2]);
    });

    it('returns input unchanged for boolean true', () => {
        expect(parseObjectQueryParam(true, meta)).toBe(true);
    });

    it('returns input unchanged for numeric input', () => {
        expect(parseObjectQueryParam(42, meta)).toBe(42);
    });
});