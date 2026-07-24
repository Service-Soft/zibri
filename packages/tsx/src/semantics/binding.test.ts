import { describe, expect, it } from '@jest/globals';

import { collectFreeIdentifiers, collectFunctionBindings, collectPatternNames, collectReferencedIdentifiers } from './binding';
import { ComponentFunction } from './component';
import { parseExpression, parseStatement } from '../__testing__/parse.helper';
import { ArrowFunctionExpression, VariableDeclaration } from '../parser/ast';

function arrow(source: string): ComponentFunction {
    const expr: ArrowFunctionExpression = parseExpression(source) as ArrowFunctionExpression;
    return expr;
}

describe('binding analysis', () => {
    describe('collectPatternNames', () => {
        it('collects names from nested destructuring, defaults, renames and rest', () => {
            const decl: VariableDeclaration = parseStatement('const { a, b: c, d = 1, e: { f }, ...g } = obj;') as VariableDeclaration;
            expect(new Set(collectPatternNames(decl.declarations[0].id))).toEqual(new Set(['a', 'c', 'd', 'f', 'g']));
        });

        it('collects names from array patterns', () => {
            const decl: VariableDeclaration = parseStatement('const [x, , y = 2, ...z] = arr;') as VariableDeclaration;
            expect(new Set(collectPatternNames(decl.declarations[0].id))).toEqual(new Set(['x', 'y', 'z']));
        });
    });

    describe('collectFunctionBindings', () => {
        it('includes params, locals, and nested function bindings', () => {
            const fn: ComponentFunction = arrow('({ prop }) => { const local = 1; function inner(p) { const deep = p; } let x; }');
            expect(collectFunctionBindings(fn)).toEqual(new Set(['prop', 'local', 'inner', 'p', 'deep', 'x']));
        });

        it('does not include the referenced free variables', () => {
            const fn: ComponentFunction = arrow('({ a }) => a + external');
            expect(collectFunctionBindings(fn).has('external')).toBe(false);
        });
    });

    describe('collectReferencedIdentifiers', () => {
        it('excludes non-computed member properties and object keys', () => {
            const refs: Set<string> = collectReferencedIdentifiers(parseExpression('a.b[c] + { d: e }.f'));
            expect(refs.has('a')).toBe(true);
            expect(refs.has('c')).toBe(true);
            expect(refs.has('e')).toBe(true);
            expect(refs.has('b')).toBe(false);
            expect(refs.has('d')).toBe(false);
            expect(refs.has('f')).toBe(false);
        });

        it('includes object shorthand references', () => {
            const refs: Set<string> = collectReferencedIdentifiers(parseExpression('({ a, b })'));
            expect(refs).toEqual(new Set(['a', 'b']));
        });
    });

    describe('collectFreeIdentifiers', () => {
        it('returns references not bound within the function', () => {
            const fn: ComponentFunction = arrow('({ label }) => { const id = makeId(); return render(label, id, GLOBAL); }');
            const free: Set<string> = collectFreeIdentifiers(fn);
            expect(free.has('makeId')).toBe(true);
            expect(free.has('render')).toBe(true);
            expect(free.has('GLOBAL')).toBe(true);
            expect(free.has('label')).toBe(false);
            expect(free.has('id')).toBe(false);
        });
    });
});