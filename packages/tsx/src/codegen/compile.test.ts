import assert from 'node:assert';

import { describe, expect, it } from '@jest/globals';

import { compile, CompileResult } from './compile';
import { parse } from '../parser/parser';
import { ValidationCode } from '../semantics/validate';

// The emitted module is ESM, so `new Function` cannot validate it — but our own parser handles
// import/export, so we use it to assert the emitted source is syntactically valid.
function expectValidModule(code: string): void {
    expect(parse(code).diagnostics).toEqual([]);
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
            + 'onClient(() => { track(shown); }); return <div>{secret}</div>; };';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toContain('setupName: "Home$$setup"');
        expect(result.code).toContain('referencedProps: ["shown"]');
        expectValidModule(result.code);
    });

    it('emits undefined client code for a static component', () => {
        const result: CompileResult = compile('export const Home = () => <div>static</div>;');
        assert(result.code);
        expect(result.code).toContain('code: undefined');
        expect(result.code).toContain('setupName: undefined');
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

    it('exports the component on exports instead of with an export statement', () => {
        const result: CompileResult = compile(
            'export const Home = ({ title }) => <h1>{title}</h1>;',
            { module: 'cjs' }
        );
        assert(result.code);
        // A local const backs the export, so a recursive component can still resolve its own name.
        expect(result.code).toContain('const Home = {');
        expect(result.code).toContain('exports.Home = Home;');
        expect(result.code).not.toContain('export const');

        const loaded: Record<string, unknown> = loadCjs(result.code);
        expect(loaded['Home']).toEqual(expect.objectContaining({ name: 'Home' }));
    });

    it('turns named imports into a destructured require', () => {
        const source: string = 'import { Card } from \'./card\';\n'
            + 'export const Home = () => <Card>hi</Card>;';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        expect(result.code).toContain('const { Card } = require("./card");');
    });

    it('renames a named import through the destructuring', () => {
        const source: string = 'import { Card as Panel } from \'./card\';\n'
            + 'export const Home = () => <Panel>hi</Panel>;';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        expect(result.code).toContain('const { Card: Panel } = require("./card");');
    });

    it('keeps a side-effect import as a bare require', () => {
        const result: CompileResult = compile(
            'import \'./styles.css\';\nexport const Home = () => <div/>;',
            { module: 'cjs' }
        );
        assert(result.code);
        expect(result.code).toContain('require("./styles.css");');
    });

    it('binds a namespace import to the module object', () => {
        const source: string = 'import * as helpers from \'./helpers\';\n'
            + 'export const Home = () => <p>{helpers.greet()}</p>;';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        expect(result.code).toContain('const helpers = require("./helpers");');
    });

    it('interops a default import so both esm and commonjs dependencies work', () => {
        const source: string = 'import layout from \'./layout\';\n'
            + 'export const Home = () => <p>{layout.name}</p>;';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        expect(result.code).toContain('const __zibriModule0 = require("./layout");');
        expect(result.code).toContain('__zibriModule0.__esModule');

        // An esm dependency hands over its default export...
        const fromEsm: Record<string, unknown> = loadCjs(result.code, () => ({
            __esModule: true,
            default: { name: 'esm layout' }
        }));
        expect(fromEsm['Home']).toBeDefined();
        // ...and a commonjs one hands over module.exports itself.
        const fromCjs: Record<string, unknown> = loadCjs(result.code, () => ({ name: 'cjs layout' }));
        expect(fromCjs['Home']).toBeDefined();
    });

    it('drops type-only and ?client imports just like the esm emit', () => {
        const source: string = 'import type { Props } from \'./types\';\n'
            + 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Home = () => { onClient(() => { new Chart(); }); return <div/>; };';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        expect(result.code).not.toContain('require');
        expect(result.clientPackages).toEqual(['chart.js']);
    });
});