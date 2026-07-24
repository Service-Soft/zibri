import { describe, expect, it } from '@jest/globals';

import { ClientScript } from './client-codegen';
import { compile, CompileResult } from '../compile';

/**
 * Exactly two things cross from the server into the browser: the props a parent passes, and the
 * browser globals a `?client` import provides. Everything the client script references must come
 * from one of those two - directly, or through a local the client code declares itself
 * (`const renamed = someProp;`).
 *
 * `onClient`, event handlers and function props are places client code is *written*, not a third
 * source of values: whatever they reference still has to resolve to a prop or a `?client` global.
 *
 * These tests exist because the source of a component body used to be shipped wholesale, which put
 * server-only code - and any literal in it - into the page for anyone to read.
 * @param source - The template source to compile.
 * @returns The emitted client script, or an empty string when the component has no client behavior.
 */
function clientScriptOf(source: string): string {
    const result: CompileResult = compile(source);
    expect(result.diagnostics).toEqual([]);
    return result.client?.code ?? '';
}

describe('server code never reaches the client script', () => {
    describe('onServer', () => {
        it('does not ship the body of an onServer block', () => {
            const script: string = clientScriptOf(
                'export const Page = ({ id }) => { '
                + 'onServer(() => { audit(`admin ${id} opened billing`, INTERNAL_ENDPOINT); }); '
                + 'return <button onClick={() => go()}>x</button>; };'
            );

            expect(script).not.toContain('audit');
            expect(script).not.toContain('INTERNAL_ENDPOINT');
            expect(script).not.toContain('admin ');
            // The handler it was shipped alongside is still there.
            expect(script).toContain('go()');
        });

        it('does not ship an onServer body nested in control flow', () => {
            const script: string = clientScriptOf(
                'export const Page = ({ admin }) => { '
                + 'if (admin) { onServer(() => { load(SECRET_KEY); }); } '
                + 'return <button onClick={() => go()}>x</button>; };'
            );

            expect(script).not.toContain('SECRET_KEY');
        });

        it('does not ship what an onServer block reads', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { let t = \'\'; onServer(() => { t = readInternalToken(); }); '
                + 'return <button onClick={() => go(t)}>x</button>; };'
            );

            expect(script).not.toContain('readInternalToken');
        });
    });

    describe('server-only statements', () => {
        it('does not ship a statement no client code depends on', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const internalUrl = \'https://internal.example.com/admin\'; '
                + 'return <button onClick={() => go()}>x</button>; };'
            );

            expect(script).not.toContain('internal.example.com');
        });

        it('keeps a declaration the client code depends on', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const label = \'go\'; '
                + 'return <button onClick={() => go(label)}>x</button>; };'
            );

            expect(script).toContain('const label = \'go\';');
        });

        it('keeps a declaration reached only indirectly', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const step = 2; function bump(n) { return n + step; } '
                + 'return <button onClick={() => go(bump(1))}>x</button>; };'
            );

            expect(script).toContain('const step = 2;');
            expect(script).toContain('function bump');
        });

        it('keeps a declaration a function prop depends on', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const unit = \'KB\'; function fmt(v) { return v + unit; } '
                + 'const dropped = serverOnlyLookup(); '
                + 'return <Chart format={fmt}/>; };'
            );

            expect(script).toContain('const unit = \'KB\';');
            expect(script).not.toContain('serverOnlyLookup');
        });
    });

    describe('props reaching the client', () => {
        it('keeps a prop that client code renamed into a local, and serializes the prop', () => {
            const result: CompileResult = compile(
                'export const Page = ({ label, secret }) => { const renamedLabel = label; '
                + 'return <button onClick={() => go(renamedLabel)}>x</button>; };'
            );
            const client: ClientScript | undefined = result.client;

            expect(client?.code).toContain('const renamedLabel = label;');
            // The rename is only valid if the prop it reads is handed to the setup...
            expect(client?.referencedProps).toContain('label');
            // ...while a prop no client code reads stays on the server.
            expect(client?.referencedProps).not.toContain('secret');
        });
    });

    describe('ordinary imports', () => {
        const template: (usage: string) => string = (usage: string) => `import { some } from './secrets';\n${usage}`;

        it('keeps a server-only import out of the client script when used in the markup', () => {
            // Rendering happens on the server, so this use is fine - it just must not travel.
            const script: string = clientScriptOf(template(
                'export const Chart = () => <div onClick={() => go()}>{some()}</div>;'
            ));

            expect(script).not.toContain('some');
        });

        it('keeps a server-only import out of the client script when used in an onServer hook', () => {
            const script: string = clientScriptOf(template(
                'export const Chart = () => { onServer(() => { track(some()); }); '
                + 'return <div onClick={() => go()}>x</div>; };'
            ));

            expect(script).not.toContain('some');
        });

        it('rejects a server-only import used inside onClient', () => {
            // The browser has no module system here: the identifier would simply be undefined, so
            // this must not compile rather than fail at runtime.
            const result: CompileResult = compile(template(
                'export const Chart = () => { onClient(() => { some(); }); return <div/>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import used inside an event handler', () => {
            const result: CompileResult = compile(template(
                'export const Chart = () => <button onClick={() => some()}>x</button>;'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import used inside a function passed to a component', () => {
            const result: CompileResult = compile(template(
                'export const Chart = () => { function update() { some(); } return <Inner update={update}/>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import reached indirectly from client code', () => {
            const result: CompileResult = compile(template(
                'export const Chart = () => { function helper() { return some(); } '
                + 'return <button onClick={() => helper()}>x</button>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('allows a ?client import in client code, since the vendor bundle provides it', () => {
            const result: CompileResult = compile(
                'import { io } from \'socket.io-client?client\';\n'
                + 'export const Chart = () => { onClient(() => { io(); }); return <div/>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.code).toContain('io()');
        });
    });
});