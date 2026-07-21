import { describe, expect, it } from '@jest/globals';

import { toPascalCase } from './to-pascal-case.function';

describe('toPascalCase', () => {
    it('converts snake_case to PascalCase', () => {
        expect(toPascalCase('my_variable_name')).toBe('MyVariableName');
    });

    it('converts kebab-case to PascalCase', () => {
        expect(toPascalCase('my-variable-name')).toBe('MyVariableName');
    });

    it('converts camelCase to PascalCase', () => {
        expect(toPascalCase('myVariableName')).toBe('MyVariableName');
    });

    it('leaves already-PascalCase input unchanged (idempotent)', () => {
        expect(toPascalCase('MyVariableName')).toBe('MyVariableName');
    });

    it('converts slash-separated segments', () => {
        expect(toPascalCase('my/variable/name')).toBe('MyVariableName');
    });

    it('handles a single lowercase word', () => {
        expect(toPascalCase('hello')).toBe('Hello');
    });

    it('handles an empty string', () => {
        expect(toPascalCase('')).toBe('');
    });
});