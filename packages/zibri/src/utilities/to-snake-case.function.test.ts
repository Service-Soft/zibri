import { describe, expect, it } from '@jest/globals';

import { toSnakeCase } from './to-snake-case.function';

describe('toSnakeCase', () => {
    it('converts camelCase to snake_case', () => {
        expect(toSnakeCase('myVariableName')).toBe('my_variable_name');
    });

    it('converts PascalCase to snake_case', () => {
        expect(toSnakeCase('MyVariableName')).toBe('my_variable_name');
    });

    it('converts kebab-case to snake_case', () => {
        expect(toSnakeCase('my-variable-name')).toBe('my_variable_name');
    });

    it('leaves already-snake_case input unchanged (idempotent)', () => {
        expect(toSnakeCase('my_variable_name')).toBe('my_variable_name');
    });

    it('collapses multiple consecutive separators into a single underscore', () => {
        expect(toSnakeCase('my__variable---name')).toBe('my_variable_name');
    });

    it('strips leading and trailing separators', () => {
        expect(toSnakeCase('_my_variable_name_')).toBe('my_variable_name');
    });

    it('handles a leading acronym by separating it from the following word', () => {
        expect(toSnakeCase('XMLHttpRequest')).toBe('xml_http_request');
    });

    it('handles an empty string', () => {
        expect(toSnakeCase('')).toBe('');
    });
});