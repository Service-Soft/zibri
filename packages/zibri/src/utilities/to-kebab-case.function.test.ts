import { describe, expect, it } from 'vitest';

import { toKebabCase } from './to-kebab-case.function.ts';

describe('toKebabCase', () => {
    it('converts camelCase to kebab-case', () => {
        expect(toKebabCase('myVariableName')).toBe('my-variable-name');
    });

    it('converts PascalCase to kebab-case', () => {
        expect(toKebabCase('MyVariableName')).toBe('my-variable-name');
    });

    it('converts snake_case to kebab-case', () => {
        expect(toKebabCase('my_variable_name')).toBe('my-variable-name');
    });

    it('leaves already-kebab-case input unchanged (idempotent)', () => {
        expect(toKebabCase('my-variable-name')).toBe('my-variable-name');
    });

    it('collapses multiple consecutive separators into a single dash', () => {
        expect(toKebabCase('my__variable---name')).toBe('my-variable-name');
    });

    it('strips leading and trailing separators', () => {
        expect(toKebabCase('-my-variable-name-')).toBe('my-variable-name');
    });

    it('converts slashes and backslashes to dashes', () => {
        expect(toKebabCase('my/variable\\name')).toBe('my-variable-name');
    });

    it('converts braces to dashes', () => {
        expect(toKebabCase('{myVariable}')).toBe('my-variable');
    });

    it('handles a leading acronym by separating it from the following word', () => {
        expect(toKebabCase('XMLHttpRequest')).toBe('xml-http-request');
    });

    it('handles an empty string', () => {
        expect(toKebabCase('')).toBe('');
    });
});