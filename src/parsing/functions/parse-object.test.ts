/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseObject } from './parse-object.function';
import { BadRequestError } from '../../error-handling';
import { ObjectParamMetadata } from '../../routing';

describe('parseObject', () => {
    const meta: ObjectParamMetadata = {
        name: 'myObject',
        type: 'object',
        required: true,
        description: undefined,
        cls: () => class Dummy {}
    };

    it('returns undefined for undefined input', () => {
        expect(parseObject(undefined, meta)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseObject(null, meta)).toBeNull();
    });

    it('returns input unchanged if not a string', () => {
        const input: object = { foo: 'bar' };
        expect(parseObject(input, meta)).toBe(input);
    });

    it('parses valid JSON object string', () => {
        const json: string = '{"a": 1, "b": "test"}';
        expect(parseObject(json, meta)).toEqual({ a: 1, b: 'test' });
    });

    it('parses valid nested object', () => {
        const json: string = '{"x": {"y": [1, 2, 3]}}';
        expect(parseObject(json, meta)).toEqual({ x: { y: [1, 2, 3] } });
    });

    it('parses empty JSON object', () => {
        expect(parseObject('{}', meta)).toEqual({});
    });

    it('throws BadRequestError for invalid JSON', () => {
        expect(() => parseObject('{invalid}', meta)).toThrow(BadRequestError);
    });

    it('throws BadRequestError with correct message', () => {
        try {
            parseObject('[', meta);
        }
        catch (error) {
            expect(error).toBeInstanceOf(BadRequestError);
            expect((error as Error).message).toBe('invalid JSON in query param "myObject"');
        }
    });

    it('parses valid array JSON string (edge case)', () => {
        // Should still parse since it's valid JSON even if semantically not an object
        expect(parseObject('[1,2]', meta)).toEqual([1, 2]);
    });

    it('returns input unchanged for boolean true', () => {
        expect(parseObject(true, meta)).toBe(true);
    });

    it('returns input unchanged for numeric input', () => {
        expect(parseObject(42, meta)).toBe(42);
    });
});