import { describe, expect, it } from '@jest/globals';

import { toScriptValue } from './script-value';

/**
 * Runs what the writer wrote, as the page's script does.
 * @param source - The written value.
 * @returns The value it evaluates to.
 */
function evaluate(source: string): unknown {
    // eslint-disable-next-line typescript/no-implied-eval
    return new Function(`return ${source};`)();
}

describe('toScriptValue', () => {
    it.each([
        ['a date', new Date(0)],
        ['a set', new Set(['a', 'b'])],
        ['a map', new Map<unknown, unknown>([['a', 1], [2, { b: true }]])],
        ['undefined', undefined],
        ['not a number', Number.NaN],
        ['infinity', Number.POSITIVE_INFINITY],
        ['negative infinity', Number.NEGATIVE_INFINITY],
        ['a bigint', 12_345_678_901_234_567_890n],
        ['undefined in an object', { a: undefined, b: 1 }],
        ['a date in an array', [new Date(1000), new Date(2000)]],
        ['a set in a map', new Map([['tags', new Set(['x'])]])]
    ])('writes %s so the page reads the same value', (_kind, value) => {
        expect(evaluate(toScriptValue(value))).toEqual(value);
    });

    // compared on its own, as no time equals the time of an invalid date
    it('writes a date that is no date as a date that is no date', () => {
        const written: unknown = evaluate(toScriptValue(new Date(Number.NaN)));

        expect(written).toBeInstanceOf(Date);
        expect(written instanceof Date && Number.isNaN(written.getTime())).toBe(true);
    });

    it('writes negative zero as negative zero', () => {
        expect(Object.is(evaluate(toScriptValue(-0)), -0)).toBe(true);
    });

    it('writes a value json can hold as json writes it', () => {
        const value: unknown = { name: 'Ada', tags: ['a', 'b'], nested: { count: 2, ok: true, none: null } };

        expect(toScriptValue(value)).toBe(JSON.stringify(value));
    });

    it('cannot end the script with a string in a set', () => {
        const source: string = toScriptValue(new Set(['</script><script>alert(1)</script>', '<!--']));

        expect(source).not.toContain('<');
        expect(evaluate(source)).toEqual(new Set(['</script><script>alert(1)</script>', '<!--']));
    });

    it('cannot end the script with a key or a string in a map', () => {
        const source: string = toScriptValue(new Map([['</script>', '</SCRIPT>']]));

        expect(source).not.toContain('<');
        expect(evaluate(source)).toEqual(new Map([['</script>', '</SCRIPT>']]));
    });

    it('escapes the line and paragraph separators', () => {
        // written by their codes, as the characters themselves end a line inside the source
        const lineSeparator: string = String.fromCodePoint(0x20_28);
        const paragraphSeparator: string = String.fromCodePoint(0x20_29);
        const value: string = `a${lineSeparator}b${paragraphSeparator}c`;
        const source: string = toScriptValue(value);

        expect(source).not.toContain(lineSeparator);
        expect(source).not.toContain(paragraphSeparator);
        expect(evaluate(source)).toBe(value);
    });

    it('leaves a function out of a value, and never writes its source', () => {
        const secret: () => string = () => 'SECRET-FUNCTION-BODY';
        const source: string = toScriptValue({ name: 'a', run: secret, list: [secret], map: new Map([['run', secret]]) });

        expect(source).not.toContain('SECRET-FUNCTION-BODY');
        expect(evaluate(source)).toEqual({ name: 'a', list: [null], map: new Map([['run', undefined]]) });
    });

    it('writes a class instance as a plain object of its fields', () => {
        class Account {
            constructor(readonly name: string) {}

            greet(): string {
                return `hi ${this.name}`;
            }
        }

        expect(evaluate(toScriptValue(new Account('Acme')))).toEqual({ name: 'Acme' });
    });

    it('writes what a value says of itself through toJSON', () => {
        const account: Record<string, unknown> = { name: 'Acme', apiToken: 'SECRET', toJSON: () => ({ name: 'Acme' }) };

        expect(toScriptValue(account)).not.toContain('SECRET');
        expect(evaluate(toScriptValue(account))).toEqual({ name: 'Acme' });
    });

    it('refuses a value that contains itself', () => {
        const value: Record<string, unknown> = { name: 'a' };
        value['self'] = value;

        expect(() => toScriptValue(value)).toThrow(TypeError);
    });
});
