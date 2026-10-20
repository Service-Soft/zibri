import * as ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';

import { ComponentInfo, findComponents, isJsxExpression, returnsJsx } from './component.ts';
import { parseTemplateArrow, parseTemplateExpression, parseTemplateOk } from '../__testing__/parse.helper.ts';

describe('component detection', () => {
    describe('isJsxExpression', () => {
        it('recognizes elements, fragments, and wrapped forms', () => {
            expect(isJsxExpression(parseTemplateExpression('<div/>'))).toBe(true);
            expect(isJsxExpression(parseTemplateExpression('(<div/>)'))).toBe(true);
            expect(isJsxExpression(parseTemplateExpression('cond ? <a/> : <b/>'))).toBe(true);
            expect(isJsxExpression(parseTemplateExpression('ok && <a/>'))).toBe(true);
            expect(isJsxExpression(parseTemplateExpression('42'))).toBe(false);
        });
    });

    describe('returnsJsx', () => {
        it('detects concise arrow JSX bodies', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('({ a }) => <div>{a}</div>');
            expect(returnsJsx(fn)).toBe(true);
        });

        it('detects JSX returns inside blocks and control flow, ignoring nested functions', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('({ ok }) => { if (!ok) { return <Empty/>; } return <Full/>; }');
            expect(returnsJsx(fn)).toBe(true);
        });

        it('is false for a non-component function', () => {
            const fn: ts.ArrowFunction = parseTemplateArrow('(a) => a + 1');
            expect(returnsJsx(fn)).toBe(false);
        });
    });

    describe('findComponents', () => {
        it('finds an exported const arrow component', () => {
            const components: ComponentInfo[] = findComponents(parseTemplateOk('export const HomePage = ({ title }) => <h1>{title}</h1>;'));
            expect(components).toHaveLength(1);
            expect(components[0]).toMatchObject({ name: 'HomePage', exported: true });
        });

        it('finds an exported function component and a default export', () => {
            const a: ComponentInfo[] = findComponents(parseTemplateOk('export function Page() { return <div/>; }'));
            expect(a[0]).toMatchObject({ name: 'Page', exported: true });
            const b: ComponentInfo[] = findComponents(parseTemplateOk('export default ({ x }) => <div>{x}</div>;'));
            expect(b[0]).toMatchObject({ name: 'default', isDefault: true });
        });

        it('ignores camelCase helpers that happen to return JSX', () => {
            const file: ts.SourceFile = parseTemplateOk('function renderRow(a, b) { return <tr>{a}{b}</tr>; }\nexport const Table = () => <table/>;');
            const names: string[] = findComponents(file).map(c => c.name);
            expect(names).toEqual(['Table']);
        });
    });
});