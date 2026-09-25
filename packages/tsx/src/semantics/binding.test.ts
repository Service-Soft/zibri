import { describe, expect, it } from '@jest/globals';
import * as ts from 'typescript';

import { collectOuterNames, collectPatternBindings, collectPatternNames, collectReferencedIdentifiers, collectReferencedSymbols } from './binding';
import { symbolOf } from './symbols';
import { parseTemplateArrow, parseTemplateBinding, parseTemplateExpression } from '../__testing__/parse.helper';

describe('binding analysis', () => {
    describe('collectPatternNames', () => {
        it('collects names from nested destructuring, defaults, renames and rest', () => {
            const names: string[] = collectPatternNames(parseTemplateBinding('const { a, b: c, d = 1, e: { f }, ...g } = obj;'));
            expect(new Set(names)).toEqual(new Set(['a', 'c', 'd', 'f', 'g']));
        });

        it('collects names from array patterns', () => {
            const names: string[] = collectPatternNames(parseTemplateBinding('const [x, , y = 2, ...z] = arr;'));
            expect(new Set(names)).toEqual(new Set(['x', 'y', 'z']));
        });
    });

    describe('collectReferencedSymbols', () => {
        it('tells apart variables that share a name', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('({ label }) => { const inner = [1].map(label => label); return label; }');
            const outer: ts.Identifier = collectPatternBindings(fn.parameters[0])[0];
            const read: ts.Symbol[] = [...collectReferencedSymbols(fn.body)];

            // the parameter of the `.map` callback, and the prop returned at the end
            expect(read.map(symbol => symbol.name)).toEqual(['label', 'label']);
            expect(read.filter(symbol => symbol === symbolOf(outer))).toHaveLength(1);
        });

        it('resolves an object shorthand to the variable it reads', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('({ a }) => ({ a })');
            const binding: ts.Identifier = collectPatternBindings(fn.parameters[0])[0];

            expect([...collectReferencedSymbols(fn.body)]).toEqual([symbolOf(binding)]);
        });

        it('leaves out a name the template declares nowhere', () => {
            expect(collectReferencedSymbols(parseTemplateExpression('undeclared + 1')).size).toBe(0);
        });
    });

    describe('collectReferencedIdentifiers', () => {
        it('excludes non-computed member properties and object keys', () => {
            const refs: Set<string> = collectReferencedIdentifiers(parseTemplateExpression('a.b[c] + { d: e }.f'));
            expect(refs.has('a')).toBe(true);
            expect(refs.has('c')).toBe(true);
            expect(refs.has('e')).toBe(true);
            expect(refs.has('b')).toBe(false);
            expect(refs.has('d')).toBe(false);
            expect(refs.has('f')).toBe(false);
        });

        it('includes object shorthand references', () => {
            const refs: Set<string> = collectReferencedIdentifiers(parseTemplateExpression('({ a, b })'));
            expect(refs).toEqual(new Set(['a', 'b']));
        });

        it('excludes names that only appear in type syntax', () => {
            const refs: Set<string> = collectReferencedIdentifiers(parseTemplateExpression('(value as Secret).field satisfies Other<Key>'));
            expect(refs).toEqual(new Set(['value']));
        });
    });

    describe('collectOuterNames', () => {
        it('returns the names read from outside the function', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('({ label }) => { const id = makeId(); return render(label, id, GLOBAL); }');
            expect(collectOuterNames(fn, fn)).toEqual(new Set(['makeId', 'render', 'GLOBAL']));
        });
    });
});