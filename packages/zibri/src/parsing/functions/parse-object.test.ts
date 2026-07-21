/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseObject } from './parse-object.function';
import { Property } from '../../entity/decorators/property.decorator';
import { JsonUtilities } from '../../utilities/json.utilities';

class Dummy {}

class Dummy2 {
    @Property.date()
    testDate!: Date;
}

describe('parseObject', () => {
    it('parses date correctly', () => {
        const parsedObject: { testDate: Date } = parseObject(JsonUtilities.stringify({ testDate: new Date() }), Dummy2) as { testDate: Date };
        expect(parsedObject.testDate).toBeInstanceOf(Date);
    });

    it('returns undefined for undefined input', () => {
        expect(parseObject(undefined, Dummy)).toBeUndefined();
    });

    it('returns null for null input', () => {
        expect(parseObject(null, Dummy)).toBeNull();
    });

    it('returns input unchanged if not a string', () => {
        const input: object = { foo: 'bar' };
        expect(parseObject(input, Dummy)).toBe(input);
    });

    it('parses valid JSON object string', () => {
        const json: string = '{"a": 1, "b": "test"}';
        expect(parseObject(json, Dummy)).toEqual({ a: 1, b: 'test' });
    });

    it('parses valid nested object', () => {
        const json: string = '{"x": {"y": [1, 2, 3]}}';
        expect(parseObject(json, Dummy)).toEqual({ x: { y: [1, 2, 3] } });
    });

    it('parses empty JSON object', () => {
        expect(parseObject('{}', Dummy)).toEqual({});
    });

    it('parses invalid json', () => {
        expect(parseObject('{invalid}', Dummy)).toEqual('{invalid}');
    });

    it('parses valid array JSON string (edge case)', () => {
        // Should still parse since it's valid JSON even if semantically not an object
        expect(parseObject('[1,2]', Dummy)).toEqual([1, 2]);
    });

    it('returns input unchanged for boolean true', () => {
        expect(parseObject(true, Dummy)).toBe(true);
    });

    it('returns input unchanged for numeric input', () => {
        expect(parseObject(42, Dummy)).toBe(42);
    });
});