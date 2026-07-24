import { describe, expect, it } from '@jest/globals';

import { ComponentInfo, findComponents, isJsxExpression, returnsJsx } from './component';
import { parseExpression, parseOk } from '../__testing__/parse.helper';
import { Expression, Program } from '../parser/ast';

function firstArrow(source: string): Expression {
    return parseExpression(source);
}

describe('component detection', () => {
    describe('isJsxExpression', () => {
        it('recognizes elements, fragments, and wrapped forms', () => {
            expect(isJsxExpression(parseExpression('<div/>'))).toBe(true);
            expect(isJsxExpression(parseExpression('(<div/>)'))).toBe(true);
            expect(isJsxExpression(parseExpression('cond ? <a/> : <b/>'))).toBe(true);
            expect(isJsxExpression(parseExpression('ok && <a/>'))).toBe(true);
            expect(isJsxExpression(parseExpression('42'))).toBe(false);
        });
    });

    describe('returnsJsx', () => {
        it('detects concise arrow JSX bodies', () => {
            const fn: Expression = firstArrow('({ a }) => <div>{a}</div>');
            expect(fn.kind).toBe('ArrowFunctionExpression');
            if (fn.kind === 'ArrowFunctionExpression') {
                expect(returnsJsx(fn)).toBe(true);
            }
        });

        it('detects JSX returns inside blocks and control flow, ignoring nested functions', () => {
            const fn: Expression = firstArrow('({ ok }) => { if (!ok) { return <Empty/>; } return <Full/>; }');
            if (fn.kind === 'ArrowFunctionExpression') {
                expect(returnsJsx(fn)).toBe(true);
            }
        });

        it('is false for a non-component function', () => {
            const fn: Expression = firstArrow('(a) => a + 1');
            if (fn.kind === 'ArrowFunctionExpression') {
                expect(returnsJsx(fn)).toBe(false);
            }
        });
    });

    describe('findComponents', () => {
        it('finds an exported const arrow component', () => {
            const program: Program = parseOk('export const HomePage = ({ title }) => <h1>{title}</h1>;');
            const components: ComponentInfo[] = findComponents(program);
            expect(components).toHaveLength(1);
            expect(components[0]).toMatchObject({ name: 'HomePage', exported: true });
        });

        it('finds an exported function component and a default export', () => {
            const a: ComponentInfo[] = findComponents(parseOk('export function Page() { return <div/>; }'));
            expect(a[0]).toMatchObject({ name: 'Page', exported: true });
            const b: ComponentInfo[] = findComponents(parseOk('export default ({ x }) => <div>{x}</div>;'));
            expect(b[0]).toMatchObject({ name: 'default', isDefault: true });
        });

        it('ignores camelCase helpers that happen to return JSX', () => {
            const program: Program = parseOk('function renderRow(a, b) { return <tr>{a}{b}</tr>; }\nexport const Table = () => <table/>;');
            const names: string[] = findComponents(program).map(c => c.name);
            expect(names).toEqual(['Table']);
        });
    });
});