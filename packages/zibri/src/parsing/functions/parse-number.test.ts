/* eslint-disable unicorn/no-null */
import { describe, expect, it } from '@jest/globals';

import { parseNumber } from './parse-number.function';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';

describe('parseNumber', () => {
    it('parses valid integer string', () => {
        expect(parseNumber('123')).toBe(123);
    });

    it('parses valid negative number string', () => {
        expect(parseNumber('-456')).toBe(-456);
    });

    it('parses valid float string', () => {
        expect(parseNumber('78.9')).toBeCloseTo(78.9);
    });

    it('parses number input directly', () => {
        expect(parseNumber(42)).toBe(42);
    });

    it('returns input unchanged for non-numeric string', () => {
        expect(parseNumber('abc')).toBe('abc');
    });

    it('returns input unchanged for null', () => {
        expect(parseNumber(null)).toBeNull();
    });

    it('returns input unchanged for undefined', () => {
        expect(parseNumber(undefined)).toBeUndefined();
    });

    it('reads a whole number past what a double holds as the bigint its property declares', () => {
        // the value json carried, which is text precisely because it does not survive as a number.
        // Read as a double it becomes 9007199254740993, which is a different number
        expect(parseNumber('9007199254740993', 'bigint')).toBe(9007199254740993n);
    });

    it('reads an exact decimal as the BigNumber its property declares', () => {
        const parsed: unknown = parseNumber('0.1', 'bignumber');

        expect(parsed).toBeInstanceOf(BigNumber);
        // and exactly, which is the whole of why the format exists: 0.1 + 0.2 is 0.30000000000000004
        // as doubles, and a price that is off by that is off
        expect(NumberUtilities.add(parsed as BigNumber, 0.2).toFixed()).toBe('0.3');
    });

    it('reads a json number into the type its property declares', () => {
        // a caller may write a small value as a json number rather than as a string, and the
        // property still holds what it says it holds
        expect(parseNumber(7, 'bigint')).toBe(7n);
        expect(parseNumber(7, 'bignumber')).toBeInstanceOf(BigNumber);
    });

    it('hands on a value that cannot be read as the declared format', () => {
        // BigInt('1.5') throws, and a parser that throws is a 500 before anything is validated -
        // so this comes back untouched and validation answers with the key and the type it wanted
        expect(parseNumber('1.5', 'bigint')).toBe('1.5');
    });
});