/* eslint-disable unicorn/no-null */
import { describe, expect, it } from 'vitest';

import { parseObject } from './parse-object.function.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { JsonUtilities } from '../../utilities/json.utilities.ts';

class Dummy {}

class Dummy2 {
    @Property.date()
    testDate!: Date;
}

class PartialBody {
    @Property.string({ required: false })
    title?: string;

    @Property.string({ required: false })
    userId?: string;
}

describe('parseObject', () => {
    it('invents no key for a property the payload does not carry', () => {
        const parsed: object = parseObject('{"title": "renamed"}', PartialBody) as object;

        // every declared property was assigned unconditionally, so a PATCH body came out carrying
        // `userId: undefined` - a key the caller never sent. `in` then answers yes for it, and
        // anything reading the change to see which columns it touches is told it touches all of
        // them: the entity scope's write check refused every ordinary partial update on that basis.
        expect(Object.keys(parsed)).toEqual(['title']);
        expect('userId' in parsed).toBe(false);
    });

    it('keeps a property the payload sets to null', () => {
        const parsed: object = parseObject('{"title": "renamed", "userId": null}', PartialBody) as object;

        // clearing a column and not mentioning it are different requests, and this is the one whose
        // key has to survive. It is also the only way a request can say it: json has no syntax for
        // `undefined`, and `JSON.stringify` drops a key holding one before it is ever sent.
        expect('userId' in parsed).toBe(true);
        expect((parsed as { userId: unknown }).userId).toBeNull();
    });

    it('keeps a property whose key is present and holds undefined', () => {
        const parsed: object = parseObject({ title: 'renamed', userId: undefined }, PartialBody) as object;

        // what decides is whether the key is there, never what it holds - so writing it out gets it
        // through whatever the value. That matters for every caller that hands this an object
        // rather than a string: a nested object inside a body, form data, a repository call.
        expect('userId' in parsed).toBe(true);
        expect((parsed as { userId: unknown }).userId).toBeUndefined();
    });

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

    it('restores every item of an array property as the item it declares', () => {
        // the array's items, rather than the array itself, are what each item is read as. Handed the
        // array, every item was read as a list of its own, which a date or an object is not - so
        // they all came back as the text and plain json they arrived as
        class Agenda {
            @Property.array({ items: { type: 'date' } })
            entries!: Date[];

            @Property.array({ items: { type: 'object', cls: () => Dummy2 } })
            reminders!: Dummy2[];
        }

        expect(parseObject({
            entries: ['2026-03-01T10:00:00.000Z'],
            reminders: [{ testDate: '2026-03-02T10:00:00.000Z' }]
        }, Agenda)).toEqual({
            entries: [new Date('2026-03-01T10:00:00.000Z')],
            reminders: [{ testDate: new Date('2026-03-02T10:00:00.000Z') }]
        });
    });
});