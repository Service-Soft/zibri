import assert from 'node:assert';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from 'vitest';

import { compile, CompileResult } from './compile.ts';
import { CompiledPage, renderPage } from '../runtime/render-page.ts';
import { createContext } from '../runtime/server-runtime.ts';
import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols.ts';
import { ValidationCode } from '../semantics/validate.ts';

/**
 * Whether a value is a compiled component a page can be rendered from.
 * @param value - The value an emitted module exports.
 * @returns True when it carries a render function and client metadata.
 */
function isCompiledPage(value: unknown): value is CompiledPage {
    return typeof value === 'object' && value !== null
        && 'render' in value && typeof value.render === 'function'
        && 'client' in value && typeof value.client === 'object';
}

// The emitted module is ESM, so `new Function` cannot validate it — but TypeScript's parser handles
// import/export, so it asserts the emitted source is syntactically valid.
function expectValidModule(code: string): void {
    expect(syntaxErrorsOf(parseTemplate(code))).toEqual([]);
}

describe('compile', () => {
    it('emits a module exporting the compiled component', () => {
        const result: CompileResult = compile('export const Home = ({ title }) => <h1>{title}</h1>;');
        assert(result.code);
        expect(result.diagnostics).toEqual([]);
        expect(result.componentName).toBe('Home');
        expectValidModule(result.code);

        expect(result.code).toContain('function __render$Home($ssr, { title })');
        expect(result.code).toContain('export const Home = {');
        expect(result.code).toContain('name: "Home"');
        expect(result.code).toContain('render: (props, $ssr) => __render$Home($ssr, props)');
    });

    it('preserves value imports so nested components resolve', () => {
        const source: string = 'import { Card } from \'./card\';\n'
            + 'export const Home = () => <Card>hi</Card>;';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toContain('import { Card } from "./card";');
        expect(result.code).toContain('$ssr.component(Card,');
        expectValidModule(result.code);
    });

    it('drops type-only imports and type-only specifiers', () => {
        const source: string = 'import type { Props } from \'./types\';\n'
            + 'import { type Other, Used } from \'./mixed\';\n'
            + 'export const Home = () => <div>{Used}</div>;';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).not.toContain('./types');
        expect(result.code).toContain('import { Used } from "./mixed";');
        expect(result.code).not.toContain('Other');
    });

    it('drops server-inlined context hook imports but keeps createContext', () => {
        // provideContext/useContext are lowered to $ssr methods, so their import bindings are dead
        // in the emitted module; keeping them would require a runtime export that does not exist.
        const source: string = 'import { createContext, provideContext, useContext } from \'zibri\';\n'
            + 'const Ctx = createContext(0);\n'
            + 'export const Home = ({ n }) => { provideContext(Ctx, n); return <div>{useContext(Ctx)}</div>; };';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toContain('import { createContext } from "zibri";');
        expect(result.code).not.toContain('provideContext } from');
        expect(result.code).toContain('$ssr.provideContext(Ctx, n)');
        expect(result.code).toContain('$ssr.useContext(Ctx)');
    });

    it('lowers $raw to the runtime constructor and drops its import', () => {
        // $raw needs no per-render state, so it is inlined to $ssr.raw like the context hooks, which
        // is what keeps it server-only and needs no runtime export.
        const source: string = 'import { $raw } from \'zibri\';\n'
            + 'export const Home = ({ children }) => <div>{$raw(\'<!--[if mso]>x<![endif]-->\')}{children}</div>;';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toContain('$ssr.raw(\'<!--[if mso]>x<![endif]-->\')');
        expect(result.code).not.toContain('from "zibri"');
    });

    it('drops ?client imports (the browser gets them as globals)', () => {
        const source: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Home = () => { onClient(() => { new Chart(); }); return <div/>; };';
        const result: CompileResult = compile(source);
        assert(result.code);
        // No import statement remains, so the server never loads the browser package...
        expect(result.code).not.toContain('import');
        // ...but the module records it so the page can emit a vendor script tag for it.
        expect(result.clientPackages).toEqual(['chart.js']);
        expect(result.code).toContain('clientPackages: ["chart.js"]');
        // The client setup still references the global.
        expect(result.client?.code).toContain('new Chart()');
    });

    it('keeps a side-effect import', () => {
        const result: CompileResult = compile('import \'./styles.css\';\nexport const Home = () => <div/>;');
        assert(result.code);
        expect(result.code).toContain('import "./styles.css";');
    });

    it('embeds the client metadata, including only referenced props', () => {
        const source: string = 'export const Home = ({ shown, secret }) => { '
            + 'onClient(() => { console.log(shown); }); return <div>{secret}</div>; };';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toMatch(/setupName: "Home\$\$setup\$[\da-f]{12}"/);
        expect(result.code).toContain('referencedProps: ["shown"]');
        expectValidModule(result.code);
    });

    it('emits undefined client code for a static component', () => {
        const result: CompileResult = compile('export const Home = () => <div>static</div>;');
        assert(result.code);
        expect(result.code).toContain('code: undefined');
        expect(result.code).toContain('setupName: undefined');
    });

    it('emits a valid module for an anonymous default export component', () => {
        // The component is found under the name 'default', which cannot name a declaration.
        const source: string = 'export default ({ x }) => <div>{x}</div>;';
        const esm: CompileResult = compile(source);
        const cjs: CompileResult = compile(source, { module: 'cjs' });
        assert(esm.code);
        assert(cjs.code);
        expectValidModule(esm.code);
        expectValidModule(cjs.code);
        expect(esm.code).toContain('export default __Component;');

        // A bundler hands `import Page from` the `default` export only of a module marked as ES module.
        const exports: Record<string, unknown> = {};
        runInNewContext(cjs.code, { exports });
        expect(exports).toHaveProperty('__esModule', true);
        expect(exports).toHaveProperty('default.name', 'default');
        expect(exports).toHaveProperty('default.render');
    });

    it('renders module-level declarations the markup reads', () => {
        const result: CompileResult = compile(
            'const UNIT = \'KB\';\nfunction size(n: number) { return `${n} ${UNIT}`; }\n'
            + 'export const Page = () => <p>{size(5)}</p>;',
            { module: 'cjs' }
        );
        assert(result.code);
        const exports: Record<string, unknown> = {};
        runInNewContext(result.code, { exports });
        const page: unknown = exports['Page'];
        assert(isCompiledPage(page));

        expect(renderPage(page)).toContain('<p>5 KB</p>');
    });

    it('exports every component a template exports', () => {
        const result: CompileResult = compile(
            'export const Page = () => <p>page</p>;\nexport const Footer = () => <footer>footer</footer>;',
            { module: 'cjs' }
        );
        assert(result.code);
        const exports: Record<string, unknown> = {};
        runInNewContext(result.code, { exports });
        const footer: unknown = exports['Footer'];
        assert(isCompiledPage(footer));

        expect(renderPage(footer)).toContain('<footer>footer</footer>');
    });

    it('reports dialect violations instead of emitting code', () => {
        const result: CompileResult = compile('export const Home = async () => <div/>;');
        expect(result.code).toBeUndefined();
        expect(result.diagnostics[0].code).toBe(ValidationCode.ASYNC_COMPONENT);
    });

    it('reports parse errors instead of emitting code', () => {
        const result: CompileResult = compile('export const Home = () => <div>oops;');
        expect(result.code).toBeUndefined();
        expect(result.diagnostics.length).toBeGreaterThan(0);
        expect(new Set(result.diagnostics.map(d => d.code))).toEqual(new Set(['ZTSX_PARSE']));
    });

    it('refuses syntax the analysis has no case for inside a component, naming it', () => {
        const source: string = 'export const Home = ({ settings }) => { with (settings) { console.log(1); } return <p/>; };';
        const result: CompileResult = compile(source);

        expect(result.code).toBeUndefined();
        expect(result.diagnostics.map(d => d.code)).toEqual(['ZTSX006']);
        expect(result.diagnostics[0].message).toContain('WithStatement');
        expect(source.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toMatch(/^with \(/);
    });

    it.each([
        ['given directly', 'icon=<button onClick={() => console.log(\'icon\')}>i</button>'],
        ['given in braces', 'icon={<button onClick={() => console.log(\'icon\')}>i</button>}']
    ])('stamps an event handler inside a JSX element prop %s', (_form, attribute) => {
        // `client` describes the first component of the template
        const result: CompileResult = compile(
            `export const Home = () => <Card ${attribute}/>;\nconst Card = ({ icon }) => <div>{icon}</div>;`
        );

        expect(result.diagnostics).toEqual([]);
        expect(result.client?.handlerSites).toHaveLength(1);
        expect(result.client?.clientPropSites).toEqual([]);
        expect(result.client?.code).toContain('console.log(\'icon\')');
    });
});

describe('compile with module: cjs', () => {
    // A commonjs module can be evaluated directly, which proves the emit is not just syntactic.

    function loadCjs(code: string, requireMock: (id: string) => unknown = () => ({})): Record<string, unknown> {
        const exported: Record<string, unknown> = {};
        // eslint-disable-next-line typescript/no-implied-eval
        const run: (exports: Record<string, unknown>, require: (id: string) => unknown) => void = new Function(
            'exports',
            'require',
            code
        ) as (exports: Record<string, unknown>, require: (id: string) => unknown) => void;
        run(exported, requireMock);
        return exported;
    }

    /**
     * Compiles a template as commonjs, loads it against the given modules and renders one of its exports.
     * @param source - The template source.
     * @param modules - The modules `require` hands out, by specifier.
     * @param exportName - The export to render.
     * @param props - The props to render it with.
     * @returns The rendered page and every specifier the module required.
     */
    function renderCjs(
        source: string,
        modules: Record<string, unknown>,
        exportName: string = 'Home',
        props: Record<string, unknown> = {}
    ): { html: string, required: string[] } {
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        const required: string[] = [];
        const loaded: Record<string, unknown> = loadCjs(result.code, id => {
            required.push(id);
            return modules[id] ?? {};
        });
        const page: unknown = loaded[exportName];
        assert(isCompiledPage(page));
        return { html: renderPage(page, props), required };
    }

    it('renders a context created at module level', () => {
        const source: string = 'import { createContext, provideContext, useContext } from \'zibri\';\n'
            + 'const Theme = createContext(\'light\');\n'
            + 'const Label = () => <span>{useContext(Theme)}</span>;\n'
            + 'export const Home = () => { provideContext(Theme, \'dark\'); return <p><Label/></p>; };';

        expect(renderCjs(source, { zibri: { createContext } }).html).toContain('<p><span>dark</span></p>');
    });

    it('renders a helper component the template does not export', () => {
        const source: string = 'const Item = ({ label }) => <li>{label}</li>;\n'
            + 'export const Home = () => <ul><Item label="a"/><Item label="b"/></ul>;';

        expect(renderCjs(source, {}).html).toContain('<ul><li>a</li><li>b</li></ul>');
    });

    it.each([
        ['a module-level constant', 'const icon = <svg/>;\nexport const Home = () => <p>x</p>;', '<svg/>'],
        ['a helper function', 'function row(label) { return <tr>{label}</tr>; }\nexport const Home = () => <table>{row(\'a\')}</table>;', '<tr>'],
        ['useContext in a helper', 'import { useContext } from \'zibri\';\nconst read = (ctx) => useContext(ctx);\nexport const Home = () => <p>x</p>;', 'useContext(ctx)']
    ])('refuses render syntax outside a component: %s', (_kind, source, located) => {
        const result: CompileResult = compile(source);

        expect(result.code).toBeUndefined();
        expect(result.diagnostics.map(d => d.code)).toEqual([ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT]);
        expect(source.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toContain(located);
    });

    it.each([
        [
            'a class',
            'class Greeter { constructor(private readonly name: string) {} greet() { return `hi ${this.name}`; } }\n'
            + 'export const Home = () => <p>{new Greeter(\'a\').greet()}</p>;',
            '<p>hi a</p>'
        ],
        ['an enum', 'enum Size { Small = \'S\' }\nexport const Home = () => <p>{Size.Small}</p>;', '<p>S</p>'],
        ['a namespace', 'namespace Units { export const kb = \'KB\'; }\nexport const Home = () => <p>{Units.kb}</p>;', '<p>KB</p>'],
        ['a generator', 'function* ids() { yield 1; yield 2; }\nexport const Home = () => <p>{[...ids()].join(\',\')}</p>;', '<p>1,2</p>'],
        [
            'for...in and do...while loops',
            'function keys(o) { const out = []; for (const k in o) { out.push(k); } let i = 0; do { i++; } while (i < 2); '
            + 'return out.join(\'\') + i; }\nexport const Home = () => <p>{keys({ a: 1, b: 2 })}</p>;',
            '<p>ab2</p>'
        ],
        ['an object getter', 'const box = { get label() { return \'boxed\'; } };\nexport const Home = () => <p>{box.label}</p>;', '<p>boxed</p>'],
        [
            'overload signatures',
            'function pad(v: string): string;\nfunction pad(v: number): string;\nfunction pad(v: string | number) { return `[${v}]`; }\n'
            + 'export const Home = () => <p>{pad(1)}</p>;',
            '<p>[1]</p>'
        ]
    ])('renders %s declared at module level', (_kind, source, expected) => {
        expect(renderCjs(source, {}).html).toContain(expected);
    });

    it('renders a JSX element given as an attribute value', () => {
        const source: string = 'const Card = ({ icon, children }) => <div>{icon}{children}</div>;\n'
            + 'export const Home = () => <Card icon=<b>i</b>>text</Card>;';
        expect(renderCjs(source, {}).html).toContain('<div><b>i</b>text</div>');
    });

    it('stamps a handler inside a JSX element given as an attribute value in the rendered page', () => {
        const source: string = 'export const Home = () => <Card icon=<button onClick={() => console.log(\'icon\')}>i</button>/>;\n'
            + 'const Card = ({ icon }) => <div>{icon}</div>;';
        expect(renderCjs(source, {}).html).toContain('<button data-ssr-handlers="h0_0:click">i</button>');
    });

    it('renders a spread child', () => {
        const source: string = 'export const Home = ({ items }) => <ul>{...items.map(item => <li>{item}</li>)}</ul>;';
        expect(renderCjs(source, {}, 'Home', { items: ['a', 'b'] }).html).toContain('<ul><li>a</li><li>b</li></ul>');
    });

    it('lets a component render itself', () => {
        // A file tree entry rendering its children resolves its own name from the module.
        const source: string = 'export const Tree = ({ depth }) => <ul>{depth > 0 ? <Tree depth={depth - 1}/> : \'leaf\'}</ul>;';
        expect(renderCjs(source, {}, 'Tree', { depth: 2 }).html).toContain('<ul><ul><ul>leaf</ul></ul></ul>');
    });

    it('exports the component on exports instead of with an export statement', () => {
        const result: CompileResult = compile('export const Home = () => <h1>hi</h1>;', { module: 'cjs' });
        assert(result.code);
        expect(result.code).not.toContain('export const');

        expect(renderCjs('export const Home = () => <h1>hi</h1>;', {}).html).toContain('<h1>hi</h1>');
    });

    it('resolves a named import', () => {
        const source: string = 'import { label } from \'./labels\';\nexport const Home = () => <p>{label}</p>;';
        expect(renderCjs(source, { './labels': { label: 'from labels' } }).html).toContain('<p>from labels</p>');
    });

    it('resolves a renamed named import', () => {
        const source: string = 'import { label as caption } from \'./labels\';\nexport const Home = () => <p>{caption}</p>;';
        expect(renderCjs(source, { './labels': { label: 'renamed' } }).html).toContain('<p>renamed</p>');
    });

    it('keeps a side-effect import', () => {
        expect(renderCjs('import \'./styles.css\';\nexport const Home = () => <div/>;', {}).required).toContain('./styles.css');
    });

    it('resolves a namespace import to the module object', () => {
        const source: string = 'import * as helpers from \'./helpers\';\nexport const Home = () => <p>{helpers.greet()}</p>;';
        expect(renderCjs(source, { './helpers': { greet: () => 'hello' } }).html).toContain('<p>hello</p>');
    });

    it('interops a default import so both esm and commonjs dependencies work', () => {
        const source: string = 'import layout from \'./layout\';\nexport const Home = () => <p>{layout.name}</p>;';

        // An esm dependency hands over its default export...
        expect(renderCjs(source, { './layout': { __esModule: true, default: { name: 'esm layout' } } }).html)
            .toContain('<p>esm layout</p>');
        // ...and a commonjs one hands over module.exports itself.
        expect(renderCjs(source, { './layout': { name: 'cjs layout' } }).html).toContain('<p>cjs layout</p>');
    });

    it('drops type-only and ?client imports just like the esm emit', () => {
        const source: string = 'import type { Props } from \'./types\';\n'
            + 'import { Chart } from \'chart.js?client\';\n'
            + 'import { onClient } from \'zibri\';\n'
            + 'export const Home = () => { onClient(() => { new Chart(); }); return <div/>; };';

        expect(renderCjs(source, { zibri: { onClient: () => undefined } }).required).toEqual(['zibri']);
        expect(compile(source, { module: 'cjs' }).clientPackages).toEqual(['chart.js']);
    });
});