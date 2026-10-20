import { describe, expect, it } from 'vitest';

import { RegexUtilities } from './regex.utilities.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { Param } from '../routing/decorators/param.decorator.ts';

describe('RegexUtilities', () => {
    it('compiles a declared pattern once', () => {
        const declared: RegExp = /^\d+$/;

        expect(RegexUtilities.resolveLinear(declared)).toBe(RegexUtilities.resolveLinear(declared));
    });

    it('takes a pattern declared as text', () => {
        expect(RegexUtilities.resolveLinear('^[a-z]+$').test('abc')).toBe(true);
        expect(RegexUtilities.resolveLinear('^[a-z]+$').test('ab1')).toBe(false);
    });

    it('keeps the flags that decide what matches', () => {
        expect(RegexUtilities.resolveLinear(/^abc$/i).test('ABC')).toBe(true);
    });

    it('answers the same for the same value every time, for a pattern declared with the global flag', () => {
        // a global RegExp remembers where its last match ended, so the second `test` of the same value
        // starts past it - harmless while every request built its own, not once the pattern is shared
        const linear: { test: (value: string) => boolean } = RegexUtilities.resolveLinear(/\d/g);

        expect([linear.test('1'), linear.test('1'), linear.test('1')]).toStrictEqual([true, true, true]);
    });

    it('runs a pattern that backtracks in time linear to the value', () => {
        const start: number = performance.now();
        const matched: boolean = RegexUtilities.resolveLinear(/^(a+)+$/).test(`${'a'.repeat(10_000)}!`);

        expect(matched).toBe(false);
        expect(performance.now() - start).toBeLessThan(100);
    });

    it('refuses a pattern with a lookaround, naming where it is declared', () => {
        expect(() => RegexUtilities.validateLinear('Account.code', /^(?=\d)\w+$/)).toThrow('Account.code');
    });

    it('refuses a pattern with a backreference', () => {
        expect(() => RegexUtilities.validateLinear('Account.code', /^(\w)\1$/)).toThrow('Account.code');
    });

    describe('is asked wherever a pattern is declared', () => {
        it('on a string property', () => {
            expect(() => {
                class Account {
                    @Property.string({ regex: /^(?=\d)\w+$/ })
                    code!: string;
                }
                return Account;
            }).toThrow('Account.code');
        });

        it('on the items of an array property', () => {
            expect(() => {
                class Account {
                    @Property.array({ items: { type: 'string', regex: /^(?=\d)\w+$/ } })
                    codes!: string[];
                }
                return Account;
            }).toThrow('Account.codes');
        });

        it('on a string parameter', () => {
            expect(() => Param.query('code', { type: 'string', regex: /^(?=\d)\w+$/ })).toThrow('code');
        });
    });
});