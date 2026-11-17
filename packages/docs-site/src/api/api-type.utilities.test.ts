import { describe, expect, it } from '@jest/globals';
import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };
import { JsonUtilities } from 'zibri';

import { ApiExport } from './api-export.model';
import { ApiReferenceUtilities } from './api-reference.utilities';
import { ApiToken } from './api-token.model';
import { ApiTypeUtilities } from './api-type.utilities';

/**
 * A type kind of typedoc, such as `union`.
 */
type TypeKind = JSONOutput.SomeType['type'];

/**
 * A type, and the code it prints as.
 */
type TypeCase = {
    type: JSONOutput.SomeType,
    code: string
};

/**
 * The code tokens print as.
 * @param tokens - The tokens.
 * @returns The code.
 */
function toCode(tokens: ApiToken[]): string {
    return tokens.map(token => token.text).join('');
}

// an id no reflection has. typedoc's ids are a type of their own, which a number only becomes as the site reads them,
// from typedoc's json
const NO_ID: JSONOutput.ReflectionId = JsonUtilities.parse('-1');

const STRING: JSONOutput.IntrinsicType = { type: 'intrinsic', name: 'string' };
const NUMBER: JSONOutput.IntrinsicType = { type: 'intrinsic', name: 'number' };
const T: JSONOutput.ReferenceType = { type: 'reference', name: 'T', target: NO_ID, refersToTypeParameter: true };

/**
 * The type of a function, as typedoc reads it.
 * @param parameters - The names of its parameters, each a string.
 * @returns The type.
 */
function functionType(parameters: string[]): JSONOutput.ReflectionType {
    return {
        type: 'reflection',
        declaration: {
            id: NO_ID,
            name: '__type',
            variant: 'declaration',
            kind: 65536,
            flags: {},
            signatures: [
                {
                    id: NO_ID,
                    name: '__type',
                    variant: 'signature',
                    kind: 4096,
                    flags: {},
                    parameters: parameters.map(name => ({ id: NO_ID, name, variant: 'param', kind: 32768, flags: {}, type: STRING })),
                    type: { type: 'intrinsic', name: 'void' }
                }
            ]
        }
    };
}

// a case for every kind of type typedoc writes, which the record makes the compiler ask for
const TYPE_CASES: Record<TypeKind, TypeCase> = {
    array: { type: { type: 'array', elementType: { type: 'union', types: [STRING, NUMBER] } }, code: '(string | number)[]' },
    conditional: {
        type: { type: 'conditional', checkType: T, extendsType: STRING, trueType: { type: 'literal', value: 'a' }, falseType: { type: 'intrinsic', name: 'never' } },
        code: 'T extends string ? "a" : never'
    },
    indexedAccess: { type: { type: 'indexedAccess', objectType: T, indexType: { type: 'literal', value: 'key' } }, code: 'T["key"]' },
    inferred: { type: { type: 'inferred', name: 'U', constraint: STRING }, code: 'infer U extends string' },
    intersection: { type: { type: 'intersection', types: [T, { type: 'union', types: [STRING, NUMBER] }] }, code: 'T & (string | number)' },
    intrinsic: { type: { type: 'intrinsic', name: 'undefined' }, code: 'undefined' },
    literal: { type: { type: 'literal', value: { negative: true, value: '12' } }, code: '-12n' },
    mapped: {
        type: { type: 'mapped', parameter: 'K', parameterType: T, templateType: STRING, readonlyModifier: '+', optionalModifier: '-' },
        code: '{ readonly [K in T]-?: string }'
    },
    namedTupleMember: { type: { type: 'namedTupleMember', name: 'first', isOptional: true, element: STRING }, code: 'first?: string' },
    optional: { type: { type: 'optional', elementType: STRING }, code: 'string?' },
    predicate: { type: { type: 'predicate', name: 'value', asserts: true, targetType: STRING }, code: 'asserts value is string' },
    query: { type: { type: 'query', queryType: { type: 'reference', name: 'config', target: NO_ID } }, code: 'typeof config' },
    reference: { type: { type: 'reference', name: 'Map', target: NO_ID, typeArguments: [STRING, NUMBER] }, code: 'Map<string, number>' },
    reflection: { type: functionType(['a', 'b']), code: '(a: string, b: string) => void' },
    rest: { type: { type: 'rest', elementType: { type: 'array', elementType: STRING } }, code: '...string[]' },
    templateLiteral: { type: { type: 'templateLiteral', head: 'id-', tail: [[STRING, '-end']] }, code: '`id-${string}-end`' },
    tuple: { type: { type: 'tuple', elements: [STRING, { type: 'optional', elementType: NUMBER }] }, code: '[string, number?]' },
    typeOperator: { type: { type: 'typeOperator', operator: 'keyof', target: T }, code: 'keyof T' },
    union: { type: { type: 'union', types: [functionType([]), STRING] }, code: '(() => void) | string' },
    unknown: { type: { type: 'unknown', name: 'Some<Raw>' }, code: 'Some<Raw>' }
};

describe('the code of a type', () => {
    it.each(Object.entries(TYPE_CASES))('prints a type of the kind %s as TypeScript writes it', (_kind, typeCase) => {
        expect(toCode(ApiTypeUtilities.resolveTypeTokens(typeCase.type))).toBe(typeCase.code);
    });

    it('colors each part as VS Code colors the same code', () => {
        const tokens: ApiToken[] = ApiTypeUtilities.resolveTypeTokens({
            type: 'union',
            types: [STRING, { type: 'literal', value: 'a' }, { type: 'literal', value: 1 }, { type: 'literal', value: null }]
        });

        expect(tokens.filter(token => token.kind != undefined)).toEqual([
            { text: 'string', kind: 'type' },
            { text: '"a"', kind: 'string' },
            { text: '1', kind: 'number' },
            { text: 'null', kind: 'keyword' }
        ]);
    });

    it('links a type zibri exports to its page, and nothing else', () => {
        const service: ApiExport | undefined = ApiReferenceUtilities.findExport('MarkdownService');
        const id: JSONOutput.ReflectionId = service?.declarations[0]?.id ?? NO_ID;

        expect(ApiTypeUtilities.resolveTypeTokens({ type: 'reference', name: 'MarkdownService', target: id })[0])
            .toEqual({ text: 'MarkdownService', kind: 'type', href: '/zibri/api/MarkdownService/' });
        expect(ApiTypeUtilities.resolveTypeTokens(T)[0]?.href).toBeUndefined();
    });
});