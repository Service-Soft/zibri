import { describe, expect, it } from '@jest/globals';

import { toCamelCase } from './to-camel-case.function';

describe('toCamelCase', () => {
    it('converts snake_case to camelCase', () => {
        expect(toCamelCase('my_variable_name')).toBe('myVariableName');
    });

    it('converts kebab-case to camelCase', () => {
        expect(toCamelCase('my-variable-name')).toBe('myVariableName');
    });

    it('converts PascalCase to camelCase', () => {
        expect(toCamelCase('MyVariableName')).toBe('myVariableName');
    });

    it('leaves already-camelCase input unchanged (idempotent)', () => {
        expect(toCamelCase('myVariableName')).toBe('myVariableName');
    });

    it('handles a single lowercase word', () => {
        expect(toCamelCase('hello')).toBe('hello');
    });

    it('returns an empty string for empty input', () => {
        expect(toCamelCase('')).toBe('');
    });

    it('handles mixed separators', () => {
        expect(toCamelCase('my.variable-name_here')).toBe('myVariableNameHere');
    });

    it('does not split a leading run of consecutive uppercase letters (acronym) from the following word', () => {
        // Note: unlike toKebabCase/toSnakeCase, toCamelCase has no acronym-boundary rule,
        // so a leading acronym gets lowercased together with the word that follows it.
        expect(toCamelCase('XMLHttpRequest')).toBe('xmlhttpRequest');
    });
});