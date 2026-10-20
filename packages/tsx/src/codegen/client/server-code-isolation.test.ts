import { describe, expect, it } from 'vitest';

import { ClientScript } from './client-codegen.ts';
import { compilePage } from '../../__testing__/server-render.helper.ts';
import { renderPage } from '../../runtime/render-page.ts';
import { ValidationCode } from '../../semantics/validate.ts';
import { compile, CompileResult } from '../compile.ts';

/**
 * Globals the pages these templates stand for provide, so client code in the tests can call something
 * without each test declaring it.
 */
const PAGE_GLOBALS: string = 'declare const go: (...values: unknown[]) => void;\n'
    + 'declare const log: (...values: unknown[]) => void;\n';

/**
 * Compiles a template written for a page that provides {@link PAGE_GLOBALS}.
 * @param source - The template source, without the declarations of the page's globals.
 * @returns The compile result, with spans relative to `PAGE_GLOBALS + source`.
 */
function compileTemplate(source: string): CompileResult {
    return compile(`${PAGE_GLOBALS}${source}`);
}

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
    const result: CompileResult = compileTemplate(source);
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

        it('does not ship a statement no client code reads from control flow that holds client code', () => {
            const script: string = clientScriptOf(
                'export const Page = ({ admin }) => { if (admin) { '
                + 'const internalUrl = \'https://internal.example.com/admin\'; onClient(() => { go(); }); } '
                + 'return <div/>; };'
            );

            expect(script).not.toContain('internal.example.com');
            expect(script).toContain('if (admin)');
            expect(script).toContain('go()');
        });

        it('does not ship a declarator no client code reads from a declaration it does read', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const label = \'go\', secret = \'SECRET-DECLARATOR\'; '
                + 'return <button onClick={() => go(label)}>x</button>; };'
            );

            expect(script).not.toContain('SECRET-DECLARATOR');
            expect(script).toContain('const label = \'go\';');
        });

        it('does not ship a declaration only the markup of an early return reads', () => {
            // The client runs the early return as a `break`, so its markup - and what only the markup
            // reads - stays on the server.
            const script: string = clientScriptOf(
                'export const Page = ({ empty }) => { const hint = \'SERVER-ONLY-HINT\'; '
                + 'if (empty) { onClient(() => { go(); }); return <p>{hint}</p>; } return <div/>; };'
            );

            expect(script).not.toContain('SERVER-ONLY-HINT');
            expect(script).toContain('break __zibriSetup;');
        });

        it('keeps what decides which client code runs inside control flow that holds client code', () => {
            const script: string = clientScriptOf(
                'export const Page = ({ items }) => { for (const item of items) { '
                + 'if (item.hidden) { continue; } let label = \'plain\'; if (item.bold) { label = \'bold\'; } '
                + 'onClient(() => { go(item, label); }); } return <div/>; };'
            );

            expect(script).toContain('continue;');
            expect(script).toContain('label = \'bold\';');
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
            const result: CompileResult = compileTemplate(
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
            const result: CompileResult = compileTemplate(template(
                'export const Chart = () => { onClient(() => { some(); }); return <div/>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import used inside an event handler', () => {
            const result: CompileResult = compileTemplate(template(
                'export const Chart = () => <button onClick={() => some()}>x</button>;'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import used inside a function passed to a component', () => {
            const result: CompileResult = compileTemplate(template(
                'export const Chart = () => { function update() { some(); } return <Inner update={update}/>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('rejects a server-only import reached indirectly from client code', () => {
            const result: CompileResult = compileTemplate(template(
                'export const Chart = () => { function helper() { return some(); } '
                + 'return <button onClick={() => helper()}>x</button>; };'
            ));

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('some');
        });

        it('allows a ?client import in client code, since the vendor bundle provides it', () => {
            const result: CompileResult = compileTemplate(
                'import { io } from \'socket.io-client?client\';\n'
                + 'export const Chart = () => { onClient(() => { io(); }); return <div/>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.code).toContain('io()');
        });
    });

    describe('names client code reads', () => {
        // Besides what the component declares and receives, client code can read exactly what the
        // browser has: its globals, the globals a `?client` import provides, globals the template
        // declares with `declare`, and the framework hooks. Any other name refuses to compile.

        it.each([
            ['a module-level declaration', 'UNIT', 'const UNIT = \'KB\';\nexport const Page = () => <button onClick={() => go(UNIT)}>x</button>;'],
            [
                'a module-level function',
                'fmt',
                'function fmt(n) { return n + \'KB\'; }\nexport const Page = () => { onClient(() => { go(fmt(1)); }); return <div/>; };'
            ],
            ['another component of the template', 'Other', 'export const Page = () => <button onClick={() => go(Other)}>x</button>;\nconst Other = () => <i/>;'],
            ['a name declared nowhere', 'process', 'export const Page = () => <button onClick={() => go(process.env.SECRET)}>x</button>;']
        ])('rejects %s read by client code', (_kind, name, source) => {
            const result: CompileResult = compileTemplate(source);

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.code)).toEqual([ValidationCode.UNAVAILABLE_NAME_IN_CLIENT_CODE]);
            expect(result.diagnostics[0].message).toContain(`'${name}'`);
            expect(`${PAGE_GLOBALS}${source}`.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toBe(name);
        });

        it('allows browser globals', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { onClient(() => { '
                + 'document.title = JSON.stringify(window.location); setTimeout(() => fetch(\'/api\'), Math.max(1, 2)); '
                + '}); return <div/>; };'
            );

            expect(script).toContain('document.title');
        });

        it('allows a global the template declares', () => {
            const script: string = clientScriptOf(
                'declare const gtag: (...values: unknown[]) => void;\n'
                + 'export const Page = () => <button onClick={() => gtag(\'event\', \'click\')}>x</button>;'
            );

            expect(script).toContain('gtag(\'event\', \'click\')');
        });

        it('allows a function the template declares', () => {
            const script: string = clientScriptOf(
                'declare function track(event: string): void;\n'
                + 'export const Page = () => <button onClick={() => track(\'click\')}>x</button>;'
            );

            expect(script).toContain('track(\'click\')');
        });

        it('keeps a module-level declaration the server render reads out of the client script', () => {
            const script: string = clientScriptOf(
                'const UNIT = \'KB-UNIT\';\nexport const Page = () => <button onClick={() => console.log(1)}>{UNIT}</button>;'
            );

            expect(script).not.toContain('KB-UNIT');
        });

        it('allows a local inside client code named like a missing global', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { onClient(() => { const process = { env: {} }; console.log(process.env); }); '
                + 'return <div/>; };'
            );

            expect(script).toContain('const process');
        });
    });

    describe('module loading in client code', () => {
        // The client script is plain text in the page, not a module: `import(...)` there resolves
        // against the page URL instead of the server's module graph, and `import.meta` is a syntax
        // error that stops every component's script on the page.

        it.each([
            ['import()', 'export const Page = () => { onClient(() => { import(\'./secrets\').then(m => m.load()); }); return <div/>; };'],
            ['import.meta', 'export const Page = () => <button onClick={() => go(import.meta.url)}>x</button>;'],
            [
                'import()',
                'export const Page = () => { function load() { return import(\'./secrets\'); } '
                + 'return <button onClick={() => load()}>x</button>; };'
            ]
        ])('rejects %s in client code', (construct, source) => {
            const result: CompileResult = compileTemplate(source);

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.code)).toEqual([ValidationCode.MODULE_LOADING_IN_CLIENT_CODE]);
            expect(result.diagnostics[0].message).toContain(construct);
            expect(`${PAGE_GLOBALS}${source}`.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toMatch(/^import/);
        });

        it('allows import() in server-only code', () => {
            const result: CompileResult = compileTemplate(
                'export const Page = () => { onServer(() => { import(\'./audit\'); }); '
                + 'return <button onClick={() => go()}>x</button>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.code).not.toContain('import');
        });
    });

    describe('names shared between server code and client code', () => {
        // What reaches the page is decided by the declaration a name refers to, not by the name: a
        // binding inside client code that shares a name with something the component body declares is
        // a different variable, and pulls nothing into the page.

        it('does not ship a body declaration because a local inside onClient shares its name', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const apiKey = \'sk-live-SERVER-ONLY\'; '
                + 'onClient(() => { const apiKey = \'public\'; log(apiKey); }); return <div/>; };'
            );

            expect(script).not.toContain('SERVER-ONLY');
            expect(script).toContain('const apiKey = \'public\';');
        });

        it('does not ship a body declaration because a loop parameter around a handler shares its name', () => {
            const script: string = clientScriptOf(
                'export const Page = ({ items }) => { const token = \'SERVER-ONLY-TOKEN\'; '
                + 'return <ul>{items.map(token => <li onClick={() => go(token)}>x</li>)}</ul>; };'
            );

            expect(script).not.toContain('SERVER-ONLY');
        });

        it('does not ship a body declaration because a parameter of a kept helper shares its name', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const key = \'SERVER-ONLY-KEY\'; '
                + 'function helper(key) { return key.toUpperCase(); } '
                + 'return <button onClick={() => helper(\'x\')}>x</button>; };'
            );

            expect(script).not.toContain('SERVER-ONLY');
            expect(script).toContain('function helper(key)');
        });

        it('does not serialize a prop because a local inside onClient shares its name', () => {
            // `referencedProps` is the list the page render writes into the document, so a prop on
            // it is a prop the browser receives.
            const result: CompileResult = compileTemplate(
                'export const Page = ({ apiToken }) => { onServer(() => { audit(apiToken); }); '
                + 'onClient(() => { const apiToken = \'local\'; log(apiToken); }); return <div/>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.referencedProps).not.toContain('apiToken');
        });

        it('does not serialize a prop because a loop parameter around a handler shares its name', () => {
            const result: CompileResult = compileTemplate(
                'export const Page = ({ secret, items }) => '
                + '<ul>{items.map(secret => <li onClick={() => go(secret)}>x</li>)}</ul>;'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.referencedProps).not.toContain('secret');
        });

        it('ships a body declaration client code reads, even where an inner binding shares its name', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { const label = \'OUTER-LABEL\'; '
                + 'onClient(() => { log(label); [\'x\'].forEach(label => log(label)); }); return <div/>; };'
            );

            expect(script).toContain('const label = \'OUTER-LABEL\';');
        });

        it('compiles client code whose local shares its name with a server import', () => {
            // The local is what client code reads; the import stays on the server.
            const script: string = clientScriptOf(
                'import { some } from \'./secrets\';\n'
                + 'export const Page = () => { onClient(() => { const some = () => 1; some(); }); return <div>{some()}</div>; };'
            );

            expect(script).toContain('const some = () => 1;');
        });

        it('still compiles client code whose names do not collide', () => {
            const result: CompileResult = compileTemplate(
                'export const Page = ({ items }) => { const label = \'go\'; '
                + 'return <ul>{items.map(item => <li onClick={() => go(label, item)}>x</li>)}</ul>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.code).toContain('const label = \'go\';');
        });
    });

    describe('what crosses the boundary is what client code reads', () => {
        // A prop or captured value is written into the page as the fields client code reads from it.
        // Where client code uses a value whole - passes it on, spreads it, stringifies it - there is no
        // field list to narrow to, and the value is written whole.

        /**
         * Renders a page with the given props and returns the document.
         * @param source - The page component source.
         * @param props - The props.
         * @returns The rendered document.
         */
        function pageWith(source: string, props: Record<string, unknown>): string {
            return renderPage(compilePage(source), props);
        }

        const account: Record<string, unknown> = {
            name: 'Acme',
            apiToken: 'TOKEN-NEVER-IN-PAGE',
            owner: { email: 'owner@acme.example', phone: 'PHONE-NEVER-IN-PAGE' }
        };
        const users: Record<string, unknown>[] = [
            { id: 'user-1', active: true, passwordHash: 'HASH-NEVER-IN-PAGE' },
            { id: 'user-2', active: false, passwordHash: 'HASH-NEVER-IN-PAGE' }
        ];

        it.each([
            ['through an alias', 'const acc = account; onClient(() => { document.title = acc.name; });'],
            ['through destructuring', 'onClient(() => { const { name } = account; document.title = name; });'],
            ['calling a method of the field', 'onClient(() => { document.title = account.name.toUpperCase(); });']
        ])('writes only the field client code reads %s', (_how, body) => {
            const page: string = pageWith(`const Page = ({ account }) => { ${body} return <div/>; };`, { account });

            expect(page).toContain('Acme');
            expect(page).not.toContain('TOKEN-NEVER-IN-PAGE');
            expect(page).not.toContain('owner@acme.example');
        });

        it('writes only the nested field client code reads', () => {
            const page: string = pageWith(
                'const Page = ({ account }) => { onClient(() => { console.log(account.owner.email); }); return <div/>; };',
                { account }
            );

            expect(page).toContain('owner@acme.example');
            expect(page).not.toContain('PHONE-NEVER-IN-PAGE');
            expect(page).not.toContain('TOKEN-NEVER-IN-PAGE');
        });

        it.each([
            ['a for...of loop', 'for (const user of users) { console.log(user.id, user.active); }'],
            ['array callbacks', 'console.log(users.filter(user => user.active).map(user => user.id));'],
            ['an element found in the array', 'console.log(users.find(user => user.active)?.id);']
        ])('writes only the fields client code reads from the elements of an array through %s', (_how, statement) => {
            const page: string = pageWith(
                `const Page = ({ users }) => { onClient(() => { ${statement} }); return <div/>; };`,
                { users }
            );

            expect(page).toContain('user-1');
            expect(page).not.toContain('HASH-NEVER-IN-PAGE');
        });

        it('keeps the length of an array whose elements client code never reads', () => {
            const page: string = pageWith(
                'const Page = ({ users }) => { onClient(() => { console.log(users.length); }); return <div/>; };',
                { users }
            );

            expect(page).toContain('"users":[null,null]');
        });

        it('writes nothing of a value client code only tests', () => {
            const page: string = pageWith(
                'const Page = ({ account }) => { onClient(() => { if (account) { console.log(\'signed in\'); } }); return <div/>; };',
                { account }
            );

            expect(page).toContain('"account":{}');
        });

        it('writes a value whole where client code uses it whole', () => {
            const page: string = pageWith(
                'const Page = ({ account }) => { onClient(() => { console.log(JSON.stringify(account)); }); return <div/>; };',
                { account }
            );

            expect(page).toContain('TOKEN-NEVER-IN-PAGE');
        });

        it('writes only the field a handler reads from a captured loop value into the page', () => {
            const page: string = renderPage(
                compilePage('const Page = ({ users }) => <ul>{users.map(user => <li onClick={() => alert(user.id)}>x</li>)}</ul>;'),
                { users: [{ id: 'user-1', passwordHash: 'HASH-NEVER-IN-PAGE' }] }
            );

            expect(page).toContain('user-1');
            expect(page).not.toContain('HASH-NEVER-IN-PAGE');
        });

        it('writes only the field a child component reads from an object handed down through .map', () => {
            const page: string = renderPage(
                compilePage(
                    'const Page = ({ users }) => <ul>{users.map(user => <UserRow user={user}/>)}</ul>;',
                    { UserRow: 'const UserRow = ({ user }) => <li onClick={() => alert(user.name)}>x</li>;' }
                ),
                { users: [{ name: 'Ada', password: 'PASSWORD-NEVER-IN-PAGE' }] }
            );

            expect(page).toContain('Ada');
            expect(page).not.toContain('PASSWORD-NEVER-IN-PAGE');
        });

        it('writes only the field client code reads from a prop into the page', () => {
            const page: string = renderPage(
                compilePage('const Page = ({ account }) => { onClient(() => { document.title = account.name; }); return <div/>; };'),
                { account: { name: 'Acme', apiToken: 'TOKEN-NEVER-IN-PAGE' } }
            );

            expect(page).toContain('Acme');
            expect(page).not.toContain('TOKEN-NEVER-IN-PAGE');
        });
    });

    describe('server-only framework hooks', () => {
        // useContext/provideContext/$raw are lowered to $ssr methods that only exist during a server
        // render, so they are as server-only as any other import - using one in client code must not
        // compile rather than reach the browser as an undefined identifier.
        it.each([
            ['useContext', 'export const A = () => { onClient(() => { read(useContext(Ctx)); }); return <div/>; };'],
            ['provideContext', 'export const A = () => { onClient(() => { provideContext(Ctx, 1); }); return <div/>; };'],
            ['$raw', 'export const A = () => { onClient(() => { el.innerHTML = $raw(\'<b>\'); }); return <div/>; };']
        ])('rejects %s used inside onClient', (name, usage) => {
            const result: CompileResult = compileTemplate(`import { ${name} } from 'zibri';\n${usage}`);

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain(name);
        });
    });
});