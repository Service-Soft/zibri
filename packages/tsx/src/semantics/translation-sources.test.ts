import assert from 'node:assert';

import { describe, expect, it } from 'vitest';

import { collectTranslationSources, TranslationSources } from './translation-sources.ts';
import { compileComponent } from '../__testing__/server-render.helper.ts';
import { ComponentClientMeta } from '../runtime/server-runtime.ts';

/**
 * Compiles a component and returns what its client code looks up.
 * @param source - The component source.
 * @returns The collected translation sources.
 */
function sourcesOf(source: string): TranslationSources {
    const client: ComponentClientMeta = compileComponent(source).client;
    assert(client.referencedTranslations, 'expected the compiled component to carry translation sources');
    return client.referencedTranslations;
}

describe('collectTranslationSources', () => {
    it('collects a plain source string', () => {
        expect(sourcesOf('const A = () => { onClient(() => { show($ts`hello`); }); return <div/>; };'))
            .toEqual({ sources: ['hello'], complete: true });
    });

    it('collects from both $t and $ts and de-duplicates', () => {
        const result: TranslationSources = sourcesOf(
            'const A = () => { onClient(() => { show($ts`one`); show($t`two`); show($ts`one`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: ['one', 'two'], complete: true });
    });

    it('finds a lookup inside a function that a handler calls', () => {
        // The whole component body ends up in the client script, so a $t behind a click is included.
        const result: TranslationSources = sourcesOf(
            'const A = () => { function greet() { alert($ts`hi there`); } '
            + 'return <button onClick={greet}>x</button>; };'
        );
        expect(result).toEqual({ sources: ['hi there'], complete: true });
    });

    it('finds a lookup inside an inline handler', () => {
        expect(sourcesOf('const A = () => <button onClick={() => alert($ts`inline`)}>x</button>;'))
            .toEqual({ sources: ['inline'], complete: true });
    });

    it('finds a lookup nested in a loop inside a handler', () => {
        const result: TranslationSources = sourcesOf(
            'const A = ({ items }) => { function run() { for (const i of items) { log($ts`deep`); } } '
            + 'return <button onClick={run}>x</button>; };'
        );
        expect(result).toEqual({ sources: ['deep'], complete: true });
    });

    it('finds lookups behind several layers of nested functions and callbacks', () => {
        const result: TranslationSources = sourcesOf([
            'const A = ({ rows }) => {',
            '    function outer() {',
            '        const inner = () => {',
            '            rows.forEach(row => {',
            '                if (row.bad) { log($ts`level four`); }',
            '                else { row.parts.map(p => log($ts`level five`)); }',
            '            });',
            '        };',
            '        inner();',
            '    }',
            '    return <button onClick={outer}>x</button>;',
            '};'
        ].join('\n'));
        expect(result).toEqual({ sources: ['level four', 'level five'], complete: true });
    });

    it('finds lookups inside a .map that builds jsx with handlers', () => {
        const result: TranslationSources = sourcesOf([
            'const A = ({ tabs }) => {',
            '    function select(id) { log($ts`selected`); }',
            '    return <div>{tabs.map(tab => <button onClick={() => select(tab.id)} title={$ts`server only`}>',
            '        {tab.label}',
            '    </button>)}</div>;',
            '};'
        ].join('\n'));
        // The handler's own lookup ships; the attribute one is resolved during the server render.
        expect(result).toEqual({ sources: ['selected'], complete: true });
    });

    it('finds a lookup inside a nested .map inside a handler', () => {
        const result: TranslationSources = sourcesOf([
            'const A = ({ groups }) => {',
            '    function run() {',
            '        groups.map(g => g.items.map(i => i.tags.map(t => log($ts`triple nested`))));',
            '    }',
            '    return <button onClick={run}>x</button>;',
            '};'
        ].join('\n'));
        expect(result).toEqual({ sources: ['triple nested'], complete: true });
    });

    it('finds lookups inside conditionals, ternaries and try blocks', () => {
        const result: TranslationSources = sourcesOf([
            'const A = ({ flag }) => {',
            '    onClient(() => {',
            '        const label = flag ? $ts`yes` : $ts`no`;',
            '        switch (label) {',
            '            case \'yes\': log($ts`in case`); break;',
            '            default: log($ts`in default`);',
            '        }',
            '        while (flag) { log($ts`in while`); }',
            '    });',
            '    return <div/>;',
            '};'
        ].join('\n'));
        expect(result).toEqual({
            sources: ['yes', 'no', 'in case', 'in default', 'in while'],
            complete: true
        });
    });

    it('collects per component, so a page and its child each carry their own sources', () => {
        const child: TranslationSources = sourcesOf(
            'const Child = () => { onClient(() => { log($ts`child string`); }); return <span/>; };'
        );
        const parent: TranslationSources = sourcesOf(
            'const Parent = () => { onClient(() => { log($ts`parent string`); }); return <div><Child/></div>; };'
        );
        // The runtime unions these across all rendered instances.
        expect(child).toEqual({ sources: ['child string'], complete: true });
        expect(parent).toEqual({ sources: ['parent string'], complete: true });
    });

    it('finds a lookup in a handler that is passed down as a prop', () => {
        const result: TranslationSources = sourcesOf(
            'const A = () => { function onPick() { log($ts`through props`); } '
            + 'return <div><Child onClick={onPick}/></div>; };'
        );
        expect(result).toEqual({ sources: ['through props'], complete: true });
    });

    it('ignores a $t that is only used in the jsx, because the server resolves it', () => {
        expect(sourcesOf('const A = () => <p>{$ts`server side`}</p>;')).toEqual({ sources: [], complete: true });
    });

    it('names the placeholder after a single key object literal', () => {
        const result: TranslationSources = sourcesOf(
            'const A = ({ n }) => { onClient(() => { show($ts`hi ${{ name: n }}`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: ['hi {name}'], complete: true });
    });

    it('names the placeholder after a quoted single key', () => {
        const result: TranslationSources = sourcesOf(
            'const A = ({ n }) => { onClient(() => { show($ts`hi ${{ \'user name\': n }}`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: ['hi {user name}'], complete: true });
    });

    it('uses the positional placeholder for a value that cannot be an object', () => {
        const result: TranslationSources = sourcesOf(
            'const A = () => { onClient(() => { show($ts`hi ${\'Tim\'} and ${2}`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: ['hi {$1} and {$2}'], complete: true });
    });

    it('doubles literal braces the same way $t does', () => {
        const result: TranslationSources = sourcesOf(
            'const A = () => { onClient(() => { show($ts`a {literal} brace`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: ['a {{literal}} brace'], complete: true });
    });

    it('reports incomplete for an interpolation that may be a single key object at runtime', () => {
        // $t names the placeholder after the object's key, which only the runtime value reveals.
        const result: TranslationSources = sourcesOf(
            'const A = ({ params }) => { onClient(() => { show($ts`hi ${params}`); }); return <div/>; };'
        );
        expect(result).toEqual({ sources: [], complete: false });
    });

    it('reports incomplete for a multi key object literal, whose key $t picks at runtime', () => {
        const result: TranslationSources = sourcesOf(
            'const A = ({ a, b }) => { onClient(() => { show($ts`hi ${{ a: a, b: b }}`); }); return <div/>; };'
        );
        expect(result.complete).toBe(false);
    });

    it('reports incomplete once anything is unresolvable, even deep inside a handler', () => {
        const result: TranslationSources = sourcesOf([
            'const A = ({ p }) => {',
            '    function run() { [1].map(() => log($ts`hi ${p}`)); }',
            '    return <button onClick={run}>x</button>;',
            '};'
        ].join('\n'));
        expect(result.complete).toBe(false);
    });

    it('collects nothing for a component without translations', () => {
        expect(collectTranslationSources([])).toEqual({ sources: [], complete: true });
    });
});