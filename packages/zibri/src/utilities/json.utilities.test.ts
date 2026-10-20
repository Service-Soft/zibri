import { describe, expect, it } from 'vitest';

import { JsonUtilities } from './json.utilities.ts';

describe('JsonUtilities', () => {
    describe('parse', () => {
        it('parses a valid JSON string', () => {
            expect(JsonUtilities.parse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
        });

        it('throws a SyntaxError for invalid JSON', () => {
            expect(() => JsonUtilities.parse('{not valid')).toThrow(SyntaxError);
        });

        it('applies a reviver function', () => {
            const result: { a: number } = JsonUtilities.parse('{"a":1}', (_key, value) => typeof value === 'number' ? value * 2 : value);
            expect(result.a).toBe(2);
        });
    });

    describe('stringify', () => {
        it('stringifies a plain object', () => {
            expect(JsonUtilities.stringify({ a: 1 })).toBe('{"a":1}');
        });

        it('converts a top-level bigint to a string', () => {
            expect(JsonUtilities.stringify(42n)).toBe('"42"');
        });

        it('converts a nested bigint field to a string', () => {
            expect(JsonUtilities.stringify({ id: 123n, name: 'x' })).toBe('{"id":"123","name":"x"}');
        });

        it('converts bigints inside arrays', () => {
            expect(JsonUtilities.stringify([1n, 2n])).toBe('["1","2"]');
        });

        it('applies a custom replacer in addition to the bigint coercion', () => {
            const result: string = JsonUtilities.stringify(
                { secret: 'abc', id: 5n },
                (key, value) => key === 'secret' ? '[REDACTED]' : value
            );
            expect(result).toBe('{"secret":"[REDACTED]","id":"5"}');
        });

        it('throws a TypeError for a circular reference', () => {
            const circular: Record<string, unknown> = {};
            circular['self'] = circular;
            expect(() => JsonUtilities.stringify(circular)).toThrow(TypeError);
        });

        it('supports indentation via the space parameter', () => {
            const result: string = JsonUtilities.stringify({ a: 1 }, undefined, 2);
            expect(result).toBe('{\n  "a": 1\n}');
        });
    });

    describe('byteSizeOf', () => {
        /**
         * Referred to twice below: json writes the same value twice rather than treating the second
         * reference as a cycle, and the size has to say so too.
         */
        const sharedValue: { a: number } = { a: 1 };

        /**
         * The only property worth asserting: the size is the one the string would have had.
         *
         * Anything looser makes it an estimate that drifts from what it estimates, and a cache budget
         * built on it starts admitting more than it says it holds.
         * @param value - The value to size both ways.
         */
        function expectSameSizeAsStringify(value: unknown): void {
            expect(JsonUtilities.byteSizeOf(value)).toBe(Buffer.byteLength(JsonUtilities.stringify(value), 'utf8'));
        }

        it.each([
            ['an integer', 1],
            ['a negative fraction', -1.5],
            ['zero', 0],
            ['a number in exponent form', 1e21],
            ['a number that is not finite', Number.NaN],
            ['infinity', Number.POSITIVE_INFINITY],
            ['true', true],
            ['false', false],
            // eslint-disable-next-line unicorn/no-null
            ['null', null],
            ['a plain string', 'plain'],
            ['a string holding a quote', 'a"b'],
            ['a string holding a backslash', 'a\\b'],
            ['a string holding a newline', 'line\nbreak'],
            ['a string holding a tab, which json has a short escape for', 'a\tb'],
            ['a string holding an unprintable character, which json escapes the long way', 'ab'],
            // cspell:disable-next-line
            ['a string holding two byte characters', 'ümläut'],
            ['a string holding three byte characters', '日本語'],
            ['a string holding a surrogate pair', 'a 😀 b'],
            ['a string holding a lone surrogate', 'a \uD800 b'],
            ['a bigint', 42n],
            ['an empty object', {}],
            ['an empty array', []],
            ['a nested object', { a: { b: [1, 2, { c: 'd' }] } }],
            ['an object holding a bigint', { id: 123n, name: 'x' }],
            ['an object whose keys need escaping', { 'a"b': 1, 'c\nd': 2 }],
            ['an object holding undefined, which json omits', { a: 1, b: undefined, c: 3 }],
            ['an array holding undefined, which json writes as null', [1, undefined, 3]],
            ['an array holding a function, which json writes as null', [1, (): number => 1, 3]],
            ['a date, which json takes through toJSON', new Date('2026-09-09T12:00:00.000Z')],
            ['an object holding a date', { at: new Date('2026-09-09T12:00:00.000Z') }],
            ['the same object twice, which is not a cycle', { first: sharedValue, second: sharedValue }]
        ])('agrees with stringify for %s', (_name, value) => {
            expectSameSizeAsStringify(value);
        });

        it('agrees with stringify for the shape a cache store sizes', () => {
            expectSameSizeAsStringify({
                key: 'user:1',
                value: {
                    // cspell:disable-next-line
                    value: { id: 'u1', name: 'Ünïcödé', roles: ['admin', 'user'] },
                    tags: ['user'],
                    createdAt: new Date('2026-09-09T12:00:00.000Z'),
                    expiresAt: new Date('2026-09-09T12:05:00.000Z')
                }
            });
        });

        it('throws a TypeError for a circular reference, the same as stringify', () => {
            const circular: Record<string, unknown> = {};
            circular['self'] = circular;

            expect(() => JsonUtilities.byteSizeOf(circular)).toThrow(TypeError);
        });

        it('reports nothing for a value json does not write at all', () => {
            expect(JsonUtilities.byteSizeOf(undefined)).toBe(0);
            expect(JsonUtilities.byteSizeOf(() => 1)).toBe(0);
        });

        it('never builds the string it measures', () => {
            // the whole point of the method: a 5 MB value used to cost a 5 MB serialization on every
            // write, done purely to count its bytes and thrown away immediately afterwards
            const large: string = 'x'.repeat(5 * 1024 * 1024);

            expect(JsonUtilities.byteSizeOf({ large })).toBe(large.length + '{"large":""}'.length);
        });
    });
});