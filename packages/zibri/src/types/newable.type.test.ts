import { describe, expect, it } from '@jest/globals';

import { isNewable } from './newable.type';

class Foo {}

class Bar extends Foo {}

describe('isNewable', () => {
    it('returns true for a class with no explicit constructor', () => {
        expect(isNewable(Foo)).toBe(true);
    });

    it('returns true for a class extending another class', () => {
        expect(isNewable(Bar)).toBe(true);
    });

    it('returns true for a class with an explicit constructor', () => {
        class WithConstructor {
            constructor(readonly x: number) {}
        }
        expect(isNewable(WithConstructor)).toBe(true);
    });

    it('returns false for a regular function', () => {
        expect(isNewable((): void => {})).toBe(false);
    });

    it('returns false for an arrow function', () => {
        expect(isNewable(() => undefined)).toBe(false);
    });

    it('returns false for a non-function value', () => {
        expect(isNewable('class Foo {}')).toBe(false);
        expect(isNewable(42)).toBe(false);
        expect(isNewable({})).toBe(false);
        expect(isNewable([])).toBe(false);
        expect(isNewable(undefined)).toBe(false);
        // eslint-disable-next-line unicorn/no-null
        expect(isNewable(null)).toBe(false);
    });
});