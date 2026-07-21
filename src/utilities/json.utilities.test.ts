import { describe, expect, it } from '@jest/globals';

import { JsonUtilities } from './json.utilities';

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
});