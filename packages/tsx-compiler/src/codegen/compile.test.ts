import assert from 'node:assert';
import { runInNewContext } from 'node:vm';

import { describe, expect, it } from '@jest/globals';
import { createContext, DiagnosticSeverity } from 'zibri-tsx';

import { compile, CompileResult } from './compile';
import { isCompiledPage, loadCjs, renderTestPage } from '../__testing__/server-render.helper';
import { parseTemplate, syntaxErrorsOf } from '../semantics/symbols';
import { ValidationCode } from '../semantics/validate';

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

    it('drops a binding the template uses as a type only, which an es module could not import', () => {
        // the way a page is usually written: the component type beside a hook, in one import. A
        // commonjs module reads a missing export as undefined, an es module refuses to load at all
        const source: string = 'import { $ts, TsxComponent } from \'zibri\';\n'
            + 'type Props = { name: string };\n'
            + 'export const Home: TsxComponent<Props> = ({ name }) => <h1>{$ts`Hello`} {name}</h1>;';
        const result: CompileResult = compile(source);
        assert(result.code);
        expect(result.code).toContain('import { $ts } from "zibri";');
        expect(result.code).not.toContain('TsxComponent');
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

        expect(renderTestPage(page)).toContain('<p>5 KB</p>');
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

        expect(renderTestPage(footer)).toContain('<footer>footer</footer>');
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

/**
 * The one diagnostic a template is refused with, and the text of the template it points at.
 */
type Refusal = {
    /**
     * The code of the diagnostic.
     */
    code: string,
    /**
     * The message of the diagnostic.
     */
    message: string,
    /**
     * The text of the template the diagnostic points at.
     */
    at: string
};

/**
 * Compiles a template that the compiler refuses with one diagnostic.
 * @param source - The template.
 * @returns The diagnostic, and the text of the template it points at.
 */
function refusalOf(source: string): Refusal {
    const result: CompileResult = compile(source);
    expect(result.code).toBeUndefined();
    expect(result.diagnostics).toHaveLength(1);
    const [diagnostic] = result.diagnostics;
    return { code: diagnostic.code, message: diagnostic.message, at: source.slice(diagnostic.span.start, diagnostic.span.end) };
}

describe('the errors a template is refused with', () => {
    describe('JSX in client code', () => {
        it.each([
            ['in onClient', 'export const A = () => { onClient(() => { const shown = <b>x</b>; console.log(shown); }); return <div/>; };'],
            ['in a handler', 'export const A = () => <button onClick={() => console.log(<b>x</b>)}>x</button>;'],
            ['in a declaration client code reads', 'export const A = () => { const shown = <b>x</b>; return <button onClick={() => console.log(shown)}>x</button>; };']
        ])('is refused %s, pointing at the JSX', (_where, source) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.JSX_IN_CLIENT_CODE);
            expect(refusal.at).toBe('<b>x</b>');
            expect(refusal.message).not.toContain('defect in the compiler');
        });

        it('allows JSX returned early by a component with client code', () => {
            const result: CompileResult = compile(
                'export const A = ({ empty }) => { onClient(() => console.log(1)); if (empty) { return <p>none</p>; } return <div/>; };'
            );

            expect(result.diagnostics).toEqual([]);
        });
    });

    describe('an import read by client code', () => {
        it('names zibri as code of the server, without suggesting ?client', () => {
            const source: string = 'import { MaskUtilities } from \'zibri\';\n'
                + 'export const A = ({ e }) => <button onClick={() => console.log(MaskUtilities.maskEmail(e))}>x</button>;';
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
            expect(refusal.at).toBe('MaskUtilities');
            expect(refusal.message).toContain('\'zibri\'');
            expect(refusal.message).not.toContain('?client');
        });

        it('names a hook of the render, without suggesting ?client', () => {
            const source: string = 'import { createContext, useContext } from \'zibri\';\n'
                + 'export const A = () => { const theme = useContext(Theme); return <button onClick={() => console.log(theme)}>x</button>; };\n'
                + 'const Theme = createContext(\'light\');';
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
            expect(refusal.at).toBe('useContext');
            expect(refusal.message).toContain('render');
            expect(refusal.message).not.toContain('?client');
        });

        it('names a file of the application, without suggesting ?client', () => {
            const source: string = 'import { mask } from \'./mask\';\n'
                + 'export const A = ({ e }) => <button onClick={() => console.log(mask(e))}>x</button>;';
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
            expect(refusal.at).toBe('mask');
            expect(refusal.message).toContain('\'./mask\'');
            expect(refusal.message).not.toContain('?client');
        });

        it('names the state as the reason for markup reading it', () => {
            const source: string = 'import { MaskUtilities } from \'zibri\';\n'
                + 'export const A = () => { const email = useState(\'a@b.c\'); return <p>{MaskUtilities.maskEmail(email.value)}</p>; };';
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
            expect(refusal.at).toBe('MaskUtilities');
            expect(refusal.message).toContain('state');
        });

        it('suggests ?client for a package', () => {
            const source: string = 'import dayjs from \'dayjs\';\n'
                + 'export const A = () => <button onClick={() => console.log(dayjs())}>x</button>;';
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
            expect(refusal.at).toBe('dayjs');
            expect(refusal.message).toContain('\'dayjs?client\'');
        });
    });

    describe('a ?client import of a file of the application', () => {
        it.each([
            ['with bindings', 'import { mask } from \'./mask?client\';\nexport const A = () => <div/>;', 'import { mask } from \'./mask?client\';'],
            ['for its effect', 'import \'../setup?client\';\nexport const A = () => <div/>;', 'import \'../setup?client\';']
        ])('is refused %s', (_form, source, located) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.CLIENT_IMPORT_OF_A_FILE);
            expect(refusal.at).toBe(located);
        });
    });

    describe('onClient outside a component', () => {
        it.each([
            ['at module level', 'onClient(() => console.log(1));\nexport const A = () => <div/>;'],
            ['in a helper', 'function start() { onClient(() => console.log(1)); }\nexport const A = () => { start(); return <div/>; };']
        ])('is refused %s', (_where, source) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT);
            expect(refusal.at).toBe('onClient(() => console.log(1))');
            expect(refusal.message).toContain('\'onClient\'');
        });
    });

    describe('a ref', () => {
        it.each([
            ['created with an argument written otherwise', 'export const A = () => { const r = useRef(0); return <p ref={r}/>; };', 'useRef(0)'],
            ['created with options in a variable', 'const options = { required: false };\nexport const A = () => { const r = useRef(options); return <p ref={r}/>; };', 'useRef(options)'],
            ['created by useRefs with an argument', 'export const A = () => { const r = useRefs({ required: false }); return <p ref={r}/>; };', 'useRefs({ required: false })'],
            ['created in a function of the component', 'export const A = () => { function make() { return useRef(); } const r = make(); return <p ref={r}/>; };', 'useRef()'],
            ['created in a block', 'export const A = ({ on }) => { if (on) { const r = useRef(); console.log(r); } return <p/>; };', 'useRef()'],
            ['created without a variable', 'export const A = () => <p ref={useRef()}/>;', 'useRef()'],
            ['put on no element and handed to no component', 'export const A = () => { const r = useRef(); return <p/>; };', 'useRef()'],
            ['of useRef put on an element in a loop', 'export const A = ({ items }) => { const r = useRef(); return <ul>{items.map(item => <li ref={r}>{item}</li>)}</ul>; };', 'ref={r}'],
            ['required, on an element a condition skips', 'export const A = ({ on }) => { const r = useRef(); return <div>{on && <p ref={r}/>}</div>; };', 'useRef()'],
            ['required, on an element an early return skips', 'export const A = ({ on }) => { const r = useRef(); if (!on) { return <p/>; } return <p ref={r}/>; };', 'useRef()'],
            ['required, on an element a condition reading state skips', 'export const A = () => { const open = useState(false); const r = useRef(); return <div>{open.value && <p ref={r}/>}</div>; };', 'useRef()'],
            ['of useRef put on the rows of a list reading state', 'export const A = () => { const items = useState(["a"]); const r = useRef(); return <ul>{items.value.map(item => <li key={item} ref={r}>{item}</li>)}</ul>; };', 'ref={r}'],
            ['of useRef put on two elements that both render', 'export const A = () => { const r = useRef(); return <div><p ref={r}/><p ref={r}/></div>; };', 'ref={r}']
        ])('is refused %s', (_how, source, located) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.REF_MISUSED);
            expect(refusal.at).toBe(located);
        });

        it('points at useRefs for one in a loop, and at required: false for one a path skips', () => {
            expect(refusalOf('export const A = ({ items }) => { const r = useRef(); return <ul>{items.map(item => <li ref={r}>{item}</li>)}</ul>; };').message)
                .toContain('useRefs');
            expect(refusalOf('export const A = ({ on }) => { const r = useRef(); return <div>{on && <p ref={r}/>}</div>; };').message)
                .toContain('{ required: false }');
        });

        it('is refused outside a component', () => {
            expect(refusalOf('const r = useRef();\nexport const A = () => <p/>;').code).toBe(ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT);
        });

        it.each([
            ['required, on an element of each branch', 'export const A = ({ on }) => { const r = useRef(); return on ? <p ref={r}/> : <span ref={r}/>; };'],
            ['not required, on an element a condition skips', 'export const A = ({ on }) => { const r = useRef({ required: false }); return <div>{on && <p ref={r}/>}</div>; };'],
            ['not required, on an element a condition reading state skips', 'export const A = () => { const open = useState(false); const r = useRef({ required: false }); return <div>{open.value && <p ref={r}/>}</div>; };'],
            ['required, on an element of each branch of a condition reading state', 'export const A = () => { const open = useState(false); const r = useRef(); return <div>{open.value ? <p ref={r}/> : <span ref={r}/>}</div>; };'],
            ['created as required in so many words', 'export const A = () => { const r = useRef({ required: true }); return <p ref={r}/>; };'],
            ['of useRefs, on an element in a loop', 'export const A = ({ items }) => { const r = useRefs(); return <ul>{items.map(item => <li ref={r}>{item}</li>)}</ul>; };'],
            ['handed to a component', 'export const A = () => { const r = useRef(); return <Field inputRef={r}/>; };\nconst Field = ({ inputRef }) => <input ref={inputRef}/>;'],
            ['on an element handed to a component as its children', 'export const A = () => { const r = useRef(); return <Card><h2 ref={r}>x</h2></Card>; };\nconst Card = ({ children }) => <section>{children}</section>;'],
            ['created after an early return', 'export const A = ({ on }) => { if (!on) { return <p/>; } const r = useRef(); return <p ref={r}/>; };'],
            ['on an element of a constant the markup renders', 'export const A = () => { const r = useRef(); const title = <h1 ref={r}>x</h1>; return <div>{title}</div>; };']
        ])('is allowed %s', (_how, source) => {
            expect(compile(source).diagnostics).toEqual([]);
        });
    });

    describe('a state', () => {
        it.each([
            ['read by markup in a form the page cannot follow', 'export const A = () => { const open = useState(false); return <div>{[open.value && <p>x</p>]}</div>; };', '[open.value && <p>x</p>]'],
            ['read by markup behind an || it cannot follow', 'export const A = () => { const open = useState(false); return <div>{(open.value && <p>x</p>) || <b>y</b>}</div>; };', '(open.value && <p>x</p>) || <b>y</b>'],
            ['read by a list whose row has no key', 'export const A = () => { const list = useState([1]); return <ul>{list.value.map(item => <li>{item}</li>)}</ul>; };', '<li>{item}</li>'],
            ['read by a list whose row has two roots', 'export const A = () => { const list = useState([1]); return <ul>{list.value.map(item => <><li key={item}>a</li><li>b</li></>)}</ul>; };', '<><li key={item}>a</li><li>b</li></>'],
            ['read by markup spreading a row into a component', 'export const A = () => { const list = useState([{ id: 1 }]); return <ul>{list.value.map(item => <li key={item.id}><Card {...item}/></li>)}</ul>; };\nconst Card = () => <p/>;', '{...item}'],
            ['read by markup holding raw html', 'export const A = () => { const open = useState(false); return <div>{open.value && <p>{$raw(\'<b>x</b>\')}</p>}</div>; };', '$raw(\'<b>x</b>\')'],
            ['read by a list holding markup in a form it cannot follow', 'export const A = () => { const list = useState([1]); return <ul>{list.value.map(item => <li key={item}>{[<b>{item}</b>]}</li>)}</ul>; };', '[<b>{item}</b>]'],
            ['read through a constant a binding reads', 'export const A = () => { const count = useState(0); const next = count.value + 1; return <p>{next}</p>; };', 'next'],
            ['changed through its value with a method', 'export const A = () => { const list = useState([1]); return <button onClick={() => list.value.push(2)}>{list.value.length}</button>; };', 'list.value.push(2)'],
            ['changed through its value by assigning a field', 'export const A = () => { const user = useState({ name: \'a\' }); return <button onClick={() => { user.value.name = \'b\'; }}>{user.value.name}</button>; };', 'user.value.name = \'b\''],
            ['created in a block', 'export const A = ({ on }) => { if (on) { const count = useState(0); console.log(count); } return <p/>; };', 'useState(0)'],
            ['created destructured', 'export const A = () => { const [count] = useState([0]); return <p>{count}</p>; };', 'useState([0])'],
            ['written as raw html by a binding', 'export const A = () => { const html = useState(\'<b>x</b>\'); return <p>{$raw(html.value)}</p>; };', '$raw(html.value)'],
            ['written through the handle useInput returns', 'export const A = ({ text }) => { const shown = useInput(text); return <button onClick={() => { shown.value = \'x\'; }}>{shown.value}</button>; };', 'shown.value = \'x\''],
            ['changed through the handle useInput returns', 'export const A = ({ items }) => { const shown = useInput(items); return <button onClick={() => shown.value.push(1)}>{shown.value.length}</button>; };', 'shown.value.push(1)'],
            ['taken by useInput in a block', 'export const A = ({ on, text }) => { if (on) { const shown = useInput(text); console.log(shown); } return <p/>; };', 'useInput(text)'],
            ['taken by useWritableInput without a variable', 'export const A = ({ value }) => <p>{useWritableInput(value).value}</p>;', 'useWritableInput(value)']
        ])('is refused %s', (_how, source, located) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.STATE_MISUSED);
            expect(refusal.at).toBe(located);
        });

        it('suggests the forms the page follows for markup in another form', () => {
            const refusal: Refusal = refusalOf(
                'export const A = () => { const open = useState(false); return <div>{[open.value && <p>x</p>]}</div>; };'
            );

            expect(refusal.message).toContain('&&');
            expect(refusal.message).toContain('.map(');
        });

        // a warning in 3.x, as the template compiled in 3.0
        it('warns about a let the markup reads and client code writes, pointing at useState, and compiles the template', () => {
            const source: string = 'export const A = () => { let on = false; return <input type="checkbox" checked={on} onChange={() => { on = !on; }}/>; };';
            const result: CompileResult = compile(source);

            expect(result.code).toBeDefined();
            expect(result.diagnostics).toEqual([
                expect.objectContaining({
                    code: ValidationCode.STATE_MISUSED,
                    severity: DiagnosticSeverity.WARNING,
                    message: expect.stringContaining('useState')
                })
            ]);
            expect(source.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toBe('on = !on');
        });

        it.each([
            ['read by markup in each row of a list of the server', 'export const A = ({ items }) => { const chosen = useState(\'\'); return <ul>{items.map(item => <li className={chosen.value === item ? \'on\' : \'\'}>{item}</li>)}</ul>; };'],
            ['read through a function a binding calls', 'export const A = () => { const count = useState(0); function label() { return `${count.value} tasks`; } return <p>{label()}</p>; };'],
            ['given a new value', 'export const A = () => { const list = useState([1]); return <button onClick={() => { list.value = [...list.value, 2]; }}>{list.value.length}</button>; };'],
            ['of a let the markup reads and only the server writes', 'export const A = ({ items }) => { let total = 0; for (const item of items) { total += item; } onServer(() => { total += 1; }); return <p>{total}</p>; };'],
            ['read by a prop of a component', 'export const A = () => { const count = useState(0); return <Shown value={count.value}/>; };\nconst Shown = ({ value }) => <p>{value}</p>;'],
            ['read by markup that follows it with &&', 'export const A = () => { const open = useState(false); return <div>{open.value && <p>x</p>}</div>; };'],
            ['read by markup that follows it with a ternary', 'export const A = () => { const open = useState(false); return <div>{open.value ? <p>x</p> : null}</div>; };'],
            ['read by a list with a key on each row', 'export const A = () => { const list = useState([1]); return <ul>{list.value.map((item, index) => <li key={item} onClick={() => console.log(index)}>{item}</li>)}</ul>; };'],
            ['read by a list with a condition in each row', 'export const A = () => { const list = useState([{ id: 1, done: true }]); return <ul>{list.value.map(item => <li key={item.id}>{item.done ? <b>y</b> : <i>n</i>}</li>)}</ul>; };'],
            ['read by markup holding a component', 'export const A = () => { const open = useState(false); return <div>{open.value && <Card/>}</div>; };\nconst Card = () => <p/>;'],
            ['read by a list of components handed the row', 'export const A = () => { const list = useState([{ id: 1 }]); return <ul>{list.value.map(item => <Card key={item.id} item={item} onPick={() => console.log(item.id)}/>)}</ul>; };\nconst Card = () => <p/>;'],
            ['read by markup placing the children', 'export const A = ({ children }) => { const open = useState(false); return <div>{open.value && <section>{children}</section>}</div>; };'],
            ['handed to a component itself', 'export const A = () => { const email = useState(\'\'); return <Field value={email}/>; };\nconst Field = ({ value }) => { const text = useWritableInput(value); return <input value={text.value} onInput={ev => { text.value = ev.currentTarget.value; }}/>; };'],
            [
                'provided to a context', 'import { createContext, provideContext, useContext } from \'zibri\';\nconst Counted = createContext(0);\n'
                + 'export const A = () => { const count = useState(0); provideContext(Counted, count.value); return <Total/>; };\n'
                + 'const Total = () => { const total = useInput(useContext(Counted)); return <p>{total.value}</p>; };'
            ],
            ['written through the handle useWritableInput returns', 'export const A = ({ value }) => { const text = useWritableInput(value); return <button onClick={() => { text.value = \'x\'; }}>{text.value}</button>; };']
        ])('is allowed %s', (_how, source) => {
            expect(compile(source).diagnostics).toEqual([]);
        });
    });

    describe('an effect', () => {
        const STATE: string = 'const count = useState(0);';

        it.each([
            ['without a list', `export const A = () => { ${STATE} useEffect(() => console.log(count.value)); return <p/>; };`, 'useEffect(() => console.log(count.value))'],
            ['with a list in a variable', `export const A = () => { ${STATE} const watched = [count]; useEffect(() => console.log(count.value), watched); return <p/>; };`, 'watched'],
            ['with a spread in its list', `export const A = () => { ${STATE} const watched = [count]; useEffect(() => console.log(count.value), [...watched]); return <p/>; };`, '...watched'],
            ['called in a block', `export const A = ({ on }) => { ${STATE} if (on) { useEffect(() => console.log(count.value), [count]); } return <p/>; };`, 'useEffect(() => console.log(count.value), [count])'],
            ['called in a function of the component', `export const A = () => { ${STATE} function watch() { useEffect(() => console.log(count.value), [count]); } watch(); return <p/>; };`, 'useEffect(() => console.log(count.value), [count])'],
            ['called in onClient', `export const A = () => { ${STATE} onClient(() => useEffect(() => console.log(count.value), [count])); return <p/>; };`, 'useEffect(() => console.log(count.value), [count])'],
            ['with its result read', `export const A = () => { ${STATE} const effect = useEffect(() => console.log(count.value), [count]); console.log(effect); return <p/>; };`, 'useEffect(() => console.log(count.value), [count])']
        ])('is refused %s', (_how, source, located) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.EFFECT_MISUSED);
            expect(refusal.at).toBe(located);
        });

        it('points at onClient for an empty list', () => {
            const refusal: Refusal = refusalOf(
                'export const A = () => { useEffect(() => console.log(1), []); return <p/>; };'
            );

            expect(refusal.code).toBe(ValidationCode.EFFECT_MISUSED);
            expect(refusal.at).toBe('[]');
            expect(refusal.message).toContain('onClient');
        });

        it('is refused outside a component', () => {
            expect(refusalOf('useEffect(() => console.log(1), [1]);\nexport const A = () => <p/>;').code)
                .toBe(ValidationCode.RENDER_SYNTAX_OUTSIDE_COMPONENT);
        });

        it.each([
            [
                'with a state and a local function in its list', `export const A = () => { ${STATE} function isBig() { return count.value > 9; } `
                + 'useEffect(() => console.log(count.value), [count, isBig]); return <p/>; };'
            ],
            [
                'returning a cleanup', `export const A = () => { ${STATE} useEffect(() => { const timer = setInterval(() => console.log(count.value), 1000); `
                + 'return () => clearInterval(timer); }, [count]); return <p/>; };'
            ],
            ['reading a name only the browser has', `export const A = () => { ${STATE} useEffect(() => { document.title = String(count.value); }, [count]); return <p/>; };`]
        ])('is allowed %s', (_how, source) => {
            expect(compile(source).diagnostics).toEqual([]);
        });
    });

    describe('a name only the browser has, read while the server renders', () => {
        it.each([
            ['in the body of a component', 'export const A = () => { const title = document.title; return <p>{title}</p>; };', 'document'],
            ['in the markup', 'export const A = () => <p>{window.location.href}</p>;', 'window'],
            ['at module level', 'const title = document.title;\nexport const A = () => <p>{title}</p>;', 'document'],
            ['in a callback the markup calls', 'export const A = ({ items }) => <ul>{items.map(item => <li>{document.title}{item}</li>)}</ul>;', 'document'],
            ['in onServer', 'export const A = () => { onServer(() => console.log(window.name)); return <p/>; };', 'window'],
            ['from a ?client import, in the body', 'import { Chart } from \'chart.js?client\';\nexport const A = () => { Chart.defaults.color = \'red\'; return <p/>; };', 'Chart'],
            ['from a ?client import, at module level', 'import { Chart } from \'chart.js?client\';\nChart.defaults.color = \'red\';\nexport const A = () => <p/>;', 'Chart']
        ])('is refused %s', (_where, source, name) => {
            const refusal: Refusal = refusalOf(source);

            expect(refusal.code).toBe(ValidationCode.BROWSER_NAME_DURING_RENDER);
            expect(refusal.at).toBe(name);
            expect(refusal.message).toContain(`'${name}'`);
        });

        it.each([
            ['under a typeof guard', 'export const A = () => <p>{typeof window === \'undefined\' ? \'\' : window.location.href}</p>;'],
            ['under a typeof guard with &&', 'export const A = () => <p>{typeof document !== \'undefined\' && document.title}</p>;'],
            ['under a typeof guard in an if', 'export const A = () => { let title = \'\'; if (typeof document !== \'undefined\') { title = document.title; } return <p>{title}</p>; };'],
            ['when the template declares it', 'declare const gtag: (...values: unknown[]) => void;\nexport const A = () => { gtag(\'x\'); return <p/>; };'],
            ['in onClient', 'export const A = () => { onClient(() => console.log(document.title)); return <p/>; };'],
            ['in a handler', 'export const A = () => <button onClick={() => console.log(window.name)}>x</button>;'],
            ['as a type', 'export const A = () => { let element: HTMLElement | undefined; onClient(() => { element = document.body; console.log(element); }); return <p/>; };'],
            ['when the server has it as well', 'export const A = () => { console.log(new URL(\'https://example.com\')); return <p/>; };'],
            ['when the component declares the name', 'export const A = () => { const location = \'here\'; return <p>{location}</p>; };'],
            ['from a ?client import, in onClient', 'import { Chart } from \'chart.js?client\';\nexport const A = () => { onClient(() => { Chart.defaults.color = \'red\'; }); return <p/>; };']
        ])('is allowed %s', (_where, source) => {
            expect(compile(source).diagnostics).toEqual([]);
        });
    });
});

describe('compile with module: cjs', () => {
    // A commonjs module can be evaluated directly, which proves the emit is not just syntactic.

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
        return { html: renderTestPage(page, props), required };
    }

    // what the build does with a template importing a package with ?client: the server module is this one,
    // and the page loads the package's browser script
    it('leaves a ?client import out of the module the server runs', () => {
        const source: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const kind = typeof Chart;\n'
            + 'export const Home = () => { onClient(() => { Chart.defaults.color = \'red\'; }); return <p>x</p>; };';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        const required: string[] = [];

        const loaded: Record<string, unknown> = loadCjs(result.code, id => {
            required.push(id);
            return id === 'chart.js' ? { Chart: { defaults: {} } } : {};
        });

        expect(required).not.toContain('chart.js');
        expect(loaded['kind']).toBe('undefined');
        expect(result.clientPackages).toEqual(['chart.js']);
    });

    it('leaves an effect and its list out of the module the server runs', () => {
        const source: string = 'import { useEffect, useState } from \'zibri\';\n'
            + 'export const Home = () => { const count = useState(1); function watched() { return count.value > 0; } '
            + 'useEffect(() => { document.title = String(count.value); }, [count, watched]); return <p>{count.value}</p>; };';
        const result: CompileResult = compile(source, { module: 'cjs' });
        assert(result.code);
        // the module also holds the client script, as a string the page receives
        const serverRender: string = result.code.slice(0, result.code.indexOf('exports.Home = {'));

        const { html } = renderCjs(source, {});

        expect(html).toContain('<p><!--b0_0-->1<!--/b0_0--></p>');
        expect(serverRender).toContain('function __render$Home');
        expect(serverRender).not.toContain('document.title');
        expect(serverRender).not.toContain('[count, watched]');
    });

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
        expect(renderCjs(source, {}).html).toContain('<button data-ssr="h0_0:click">i</button>');
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