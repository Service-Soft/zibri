import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createContext } from 'zibri-tsx';
import { SERVER_HOOKS } from 'zibri-tsx/internal';

import { ClientScript } from './client-codegen';
import { compilePage, renderTemplateDocument, renderTestPage } from '../../__testing__/server-render.helper';
import { ValidationCode } from '../../semantics/validate';
import { compile, CompileResult } from '../compile';

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

        it('rejects arguments at the scope of the component', () => {
            // The compiled render takes the render runtime first, so `arguments` there is not the props.
            const source: string = 'export function Page(props) { return <button onClick={() => go(arguments[0])}>x</button>; }';
            const result: CompileResult = compileTemplate(source);

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.code)).toEqual([ValidationCode.ARGUMENTS_IN_COMPONENT]);
            expect(`${PAGE_GLOBALS}${source}`.slice(result.diagnostics[0].span.start, result.diagnostics[0].span.end)).toBe('arguments');
        });

        it('allows arguments of a function the component declares', () => {
            const script: string = clientScriptOf(
                'export const Page = () => { function f() { return arguments.length; } return <button onClick={() => go(f())}>x</button>; };'
            );

            expect(script).toContain('arguments.length');
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
            return renderTestPage(compilePage(source), props);
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
                'const Page = ({ account }) => { onClient(() => { if (account) { console.log(\'logged in\'); } }); return <div/>; };',
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
            const page: string = renderTestPage(
                compilePage('const Page = ({ users }) => <ul>{users.map(user => <li onClick={() => alert(user.id)}>x</li>)}</ul>;'),
                { users: [{ id: 'user-1', passwordHash: 'HASH-NEVER-IN-PAGE' }] }
            );

            expect(page).toContain('user-1');
            expect(page).not.toContain('HASH-NEVER-IN-PAGE');
        });

        it('writes only the field a child component reads from an object handed down through .map', () => {
            const page: string = renderTestPage(
                compilePage(
                    'const Page = ({ users }) => <ul>{users.map(user => <UserRow user={user}/>)}</ul>;',
                    { UserRow: 'const UserRow = ({ user }) => <li onClick={() => alert(user.name)}>x</li>;' }
                ),
                { users: [{ name: 'Ada', password: 'PASSWORD-NEVER-IN-PAGE' }] }
            );

            expect(page).toContain('Ada');
            expect(page).not.toContain('PASSWORD-NEVER-IN-PAGE');
        });

        it('hands a child the value the server computed with a callback, and writes only what client code reads', () => {
            const page: string = renderTestPage(
                compilePage(
                    'const Page = ({ users }) => <Picker users={users.filter(user => user.active)}/>;',
                    { Picker: 'const Picker = ({ users }) => { onClient(() => { console.log(users.map(user => user.id)); }); return <ul>{users.map(user => <li>{user.id}</li>)}</ul>; };' }
                ),
                { users }
            );

            expect(page).toContain('<li>user-1</li>');
            expect(page).not.toContain('user-2');
            expect(page).not.toContain('HASH-NEVER-IN-PAGE');
        });

        it('writes only the field client code reads from a prop into the page', () => {
            const page: string = renderTestPage(
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

/**
 * The value the tests below keep on the server, wherever they keep it.
 */
const SECRET: string = 'SERVER-SECRET';

/**
 * The name of the environment variable holding {@link SECRET}.
 */
const SECRET_VARIABLE: string = 'ZIBRI_TSX_ISOLATION_TEST_SECRET';

/**
 * What every template below starts with: a server module holding the secret, the hooks, and a function
 * of the page for client code to hand values to.
 */
const SERVER_TEMPLATE_START: string = 'import { onClient, onServer, useContext } from \'zibri\';\n'
    + 'import { env, name, SecretContext } from \'./secrets\';\n'
    + 'declare const go: (...values: unknown[]) => void;\n';

/**
 * A template written after {@link SERVER_TEMPLATE_START}, with the props it renders with.
 */
type TemplateCase = [how: string, source: string, props: Record<string, unknown>];

/**
 * The document a page receives from a template that imports a server module holding the secret.
 * @param source - The template, without {@link SERVER_TEMPLATE_START}.
 * @param props - The props to render with.
 * @returns The document, or undefined when the template does not compile.
 */
function documentOf(source: string, props: Record<string, unknown> = {}): string | undefined {
    return renderTemplateDocument(`${SERVER_TEMPLATE_START}${source}`, {
        zibri: SERVER_HOOKS,
        './secrets': {
            env: {
                DB_PASSWORD: SECRET,
                rows: [{ id: 1, password: SECRET }],
                oauthProviders: [{ id: 'google', clientSecret: SECRET }]
            },
            name: SECRET,
            mask: (value: string) => `${value.slice(0, 1)}***`,
            SecretContext: createContext({ password: SECRET })
        }
    }, props);
}

describe('what a page receives from a template', () => {
    // These run a template the whole way: through `compile` with every check, the emitted module loaded
    // against a real server module, and the finished document searched. A case holds whether the
    // compiler refuses the template or leaves the value out; what it may not do is put it in the page.

    beforeAll(() => {
        process.env[SECRET_VARIABLE] = SECRET;
    });

    afterAll(() => {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete process.env[SECRET_VARIABLE];
    });

    describe('code of the server', () => {
        // The client script is printed from the template's own source; no module a template imports is
        // ever read by the compiler, so no code of the server can be in the page, whatever a module and
        // the modules it re-exports hold.
        it.each([
            ['the markup', 'export const Page = () => <p>{name}</p>;'],
            ['the body', 'export const Page = () => { const k = env.DB_PASSWORD; return <p>{k}</p>; };'],
            ['an onServer block', 'export const Page = () => { onServer(() => { console.log(env.DB_PASSWORD); }); return <button onClick={() => go()}>x</button>; };'],
            ['a loop with a handler', 'export const Page = () => <ul>{env.rows.map(r => <li onClick={() => go(r.id)}>{r.password}</li>)}</ul>;']
        ])('keeps the import a component reads in %s out of the page', (_where, source) => {
            const document: string | undefined = documentOf(source);

            expect(document).toBeDefined();
            expect(document).not.toContain('import');
            expect(document).not.toContain('require(');
            expect(document).not.toContain('env.');
        });
    });

    describe('an initial state', () => {
        // the argument of useState runs on the server, and what it returns crosses as a value, narrowed to what
        // client code reads of it (GOALS.md, "What reaches a page")
        it.each([
            ['a call of a server helper', 'const shown = useState(mask(name));'],
            ['a local the argument reads', 'const masked = mask(name); const shown = useState(masked);']
        ])('writes what %s returns, and nothing of the helper or what it read', (_how, declaration) => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\nimport { mask } from \'./secrets\';\n'
                + `export const Page = () => { ${declaration} return <button onClick={() => go(shown.value)}>x</button>; };`
            );

            expect(document).toBeDefined();
            expect(document).toContain(`"${SECRET.slice(0, 1)}***"`);
            expect(document).not.toContain(SECRET);
            expect(document).not.toContain('mask');
        });

        it('writes the fields client code reads of it', () => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const row = useState(env.rows[0]); return <button onClick={() => go(row.value.id)}>x</button>; };'
            );

            expect(document).toContain('"row":{"id":1}');
            expect(document).not.toContain(SECRET);
        });

        it('writes nothing more of it for an effect that lists it', () => {
            const document: string | undefined = documentOf(
                'import { useEffect, useState } from \'zibri\';\n'
                + 'export const Page = () => { const row = useState(env.rows[0]); useEffect(() => go(row.value.id), [row]); return <div/>; };'
            );

            expect(document).toContain('"row":{"id":1}');
            expect(document).not.toContain(SECRET);
        });

        it('leaves a function of it out', () => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const item = useState({ label: \'x\', run: () => env.DB_PASSWORD }); return <button onClick={() => go(item.value)}>x</button>; };'
            );

            expect(document).toContain('"item":{"label":"x"}');
            expect(document).not.toContain('DB_PASSWORD');
            expect(document).not.toContain(SECRET);
        });
    });

    describe('state across components', () => {
        // a state handed to a component is a reference, an expression reading state is client code of the parent, and
        // the argument of useInput runs on the server (GOALS.md, "State across components")
        const LABEL: string = 'const Label = ({ text }) => <p>{text}</p>;';

        it('writes a state handed to a component once, as its initial value, and nothing of the server', () => {
            const document: string | undefined = documentOf(
                'import { useState, useWritableInput } from \'zibri\';\nimport { mask } from \'./secrets\';\n'
                + 'export const Page = () => { const email = useState(mask(name)); return <Field value={email}/>; };\n'
                + 'const Field = ({ value }) => { const text = useWritableInput(value); return <input value={text.value} onInput={ev => { text.value = ev.currentTarget.value; }}/>; };'
            );

            expect(document).toContain('"email":"S***"');
            expect(document).not.toContain(SECRET);
            expect(document).not.toContain('mask');
        });

        it('writes what client code of the parent reads of a state an expression handed to a component reads', () => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + `export const Page = () => { const row = useState(env.rows[0]); return <Label text={row.value.id}/>; };\n${LABEL}`
            );

            expect(document).toContain('"row":{"id":1}');
            expect(document).not.toContain(SECRET);
        });

        it('writes what the rows of a list rendered in the browser read of its items, and nothing more', () => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const rows = useState(env.rows); return <ul>{rows.value.map(row => <li key={row.id}>{row.id}</li>)}</ul>; };'
            );

            expect(document).toContain('"rows":[{"id":1}]');
            expect(document).not.toContain(SECRET);
        });

        it('keeps the argument of useInput on the server, and writes what it returns, narrowed', () => {
            const document: string | undefined = documentOf(
                'import { useInput } from \'zibri\';\n'
                + 'export const Page = () => <Card row={env.rows[0]}/>;\n'
                + 'const Card = ({ row }) => { const shown = useInput(row); return <button onClick={() => go(shown.value.id)}>x</button>; };'
            );

            expect(document).toContain('"shown":{"id":1}');
            expect(document).not.toContain(SECRET);
            expect(document).not.toContain('env');
        });
    });

    describe('a ref', () => {
        // a ref crosses as neither a prop nor a capture: its element carries the stamp, and the setup reading it
        // gets what names it, which is written in the template's own source (GOALS.md, "What reaches a page")
        it('writes the stamp on its element, and for the setup what names the ref, and nothing of the server', () => {
            const document: string | undefined = documentOf(
                'import { useRef } from \'zibri\';\n'
                + 'export const Page = () => { const input = useRef<HTMLInputElement>(); onClient(() => { go(input.current.value); }); '
                + 'return <Field inputRef={input} secret={env.DB_PASSWORD}/>; };\n'
                + 'const Field = ({ inputRef, secret }) => <input ref={inputRef} title={secret.length > 0 ? \'set\' : \'\'}/>;'
            );

            expect(document).not.toContain(SECRET);
            expect(document).toContain('<input title="set" data-ssr="r0"/>');
            expect(document).toContain('"refs":{"input":{"id":"r0","name":"input","component":"Page","many":false,"required":true}}');
        });
    });

    describe('a template the page copies', () => {
        // the server renders a branch or a row holding a component into a template: html of the server like the rest of
        // the page, holding no value reading a state or the row (GOALS.md, "Templates")
        it('leaves the row out of the template, and writes what the components of a list are handed of it, narrowed', () => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const rows = useState(env.rows); return <ul>{rows.value.map(row => <Item key={row.id} id={row.id}/>)}</ul>; };\n'
                + 'const Item = ({ id }) => <li>{id}</li>;'
            );

            expect(document).toMatch(/<template data-zt="t\d+"><!--\{p\d+--><li><!--(\w+)--><!--\/\1--><\/li><!--\}--><\/template>/);
            expect(document).toContain('"rows":[{"id":1}]');
            expect(document).not.toContain(SECRET);
        });

        it.each([
            ['a hole', '<p>{name}</p>'],
            ['a prop of a component', '<Label text={name}/>'],
            ['a list', '<ul>{[name].map(n => <li title={n}>{n}</li>)}</ul>']
        ])('renders a value of the server in %s of such markup as html, and puts nothing of it into the script', (_where, markup) => {
            const document: string | undefined = documentOf(
                'import { useState } from \'zibri\';\n'
                + `export const Page = () => { const s = useState(true); return <div>{s.value && ${markup}}</div>; };\n`
                + 'const Label = ({ text }) => <p>{text}</p>;'
            );
            const [html, script] = (document ?? '').split('<script');

            expect(html).toContain(SECRET);
            expect(script).toBeDefined();
            expect(script).not.toContain(SECRET);
            // what a getter of the markup reading it would print
            expect(script).not.toContain('=> (name)');
        });
    });

    describe('client code reading a server value', () => {
        it.each([
            ['a handler', 'export const Page = () => <button onClick={() => go(env.DB_PASSWORD)}>x</button>;'],
            ['onClient', 'export const Page = () => { onClient(() => { go(env.DB_PASSWORD); }); return <div/>; };'],
            ['a local of the body', 'export const Page = () => { const k = env.DB_PASSWORD; return <button onClick={() => go(k)}>x</button>; };'],
            ['a destructured local', 'export const Page = () => { const { DB_PASSWORD } = env; return <button onClick={() => go(DB_PASSWORD)}>x</button>; };'],
            ['a helper', 'export const Page = () => { function h() { return env.DB_PASSWORD; } return <button onClick={() => go(h())}>x</button>; };'],
            ['a shorthand property', 'export const Page = () => <button onClick={() => go({ env })}>x</button>;'],
            ['a computed key', 'export const Page = () => <button onClick={() => go({ [env.DB_PASSWORD]: 1 })}>x</button>;'],
            ['a default of a handler parameter', 'export const Page = () => <button onClick={(a = env.DB_PASSWORD) => go(a)}>x</button>;'],
            ['a class field', 'export const Page = () => <button onClick={() => { class X { f = env.DB_PASSWORD; } go(new X()); }}>x</button>;'],
            ['a template literal', 'export const Page = () => <button onClick={() => go(`${env.DB_PASSWORD}`)}>x</button>;'],
            ['a type assertion', 'export const Page = () => <button onClick={() => go((env as Record<string, string>).DB_PASSWORD)}>x</button>;'],
            ['an import named like a browser global', 'export const Page = () => <button onClick={() => go(name)}>x</button>;'],
            ['the handler itself', 'export const Page = () => <button onClick={env.DB_PASSWORD}>x</button>;'],
            [
                'an effect', 'import { useEffect, useState } from \'zibri\';\n'
                + 'export const Page = () => { const s = useState(0); useEffect(() => { go(env.DB_PASSWORD); }, [s]); return <p>{s.value}</p>; };'
            ],
            [
                'a prop following a state', 'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const s = useState(0); return <Label text={env.DB_PASSWORD + s.value}/>; };\nconst Label = ({ text }) => <p>{text}</p>;'
            ],
            [
                'markup the page renders again', 'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const s = useState(true); return <div>{s.value && <p>{env.DB_PASSWORD + s.value}</p>}</div>; };'
            ],
            [
                'a component in markup the page renders again', 'import { useState } from \'zibri\';\n'
                + 'export const Page = () => { const s = useState(true); return <div>{s.value && <Label text={env.DB_PASSWORD + s.value}/>}</div>; };\n'
                + 'const Label = ({ text }) => <p>{text}</p>;'
            ],
            [
                'a context following a state', 'import { provideContext, useState } from \'zibri\';\n'
                + 'export const Page = () => { const s = useState(0); provideContext(SecretContext, env.DB_PASSWORD + s.value); return <div/>; };'
            ],
            [
                'the list of an effect', 'import { useEffect } from \'zibri\';\n'
                + 'export const Page = () => { useEffect(() => { go(1); }, [env]); return <div/>; };'
            ],
            ['a condition around onClient', 'export const Page = () => { if (env.DB_PASSWORD) { onClient(() => { go(1); }); } return <div/>; };'],
            ['process.env', `export const Page = () => <button onClick={() => go(process.env.${SECRET_VARIABLE})}>x</button>;`],
            ['a module-level constant', `const M = '${SECRET}';\nexport const Page = () => <button onClick={() => go(M)}>x</button>;`],
            ['import()', 'export const Page = () => <button onClick={() => import(\'./secrets\')}>x</button>;'],
            ['require()', 'export const Page = () => <button onClick={() => go(require(\'./secrets\'))}>x</button>;'],
            ['import = require', 'import s = require(\'./secrets\');\nexport const Page = () => <button onClick={() => go(s.env)}>x</button>;'],
            ['a default of a prop client code reads', 'export const Page = ({ k = env.DB_PASSWORD }) => <button onClick={() => go(k)}>x</button>;'],
            ['a default of a prop another default reads', 'export const Page = ({ k = env.DB_PASSWORD, l = k }) => <button onClick={() => go(l)}>x</button>;'],
            ['a function prop', 'const Inner = () => <div/>;\nexport const Page = () => <Inner f={() => env.DB_PASSWORD}/>;'],
            ['a config holding a function', 'const Inner = () => <div/>;\nexport const Page = () => <Inner c={{ k: env.DB_PASSWORD, f: () => 1 }}/>;'],
            ['a component nested in the body', 'export const Page = () => { const Inner = () => <button onClick={() => go(env.DB_PASSWORD)}>x</button>; return <Inner/>; };'],
            ['a component wrapped in a call', 'const wrap = f => f;\nexport const Page = wrap(() => <button onClick={() => go(env.DB_PASSWORD)}>x</button>);'],
            ['useContext', 'export const Page = () => <button onClick={() => go(useContext(SecretContext))}>x</button>;']
        ])('refuses %s', (_how, source) => {
            expect(documentOf(source)).toBeUndefined();
        });
    });

    describe('a value a handler captures', () => {
        // A handler written in a loop or a block captures the variables of that scope, and the render
        // writes each captured value into the page, narrowed to what the handler reads from it. The
        // value comes from wherever the markup took it; the compiler does not trace that. A server
        // value an author hands to a handler this way is written like any other - the open gap named in
        // GOALS.md.

        it.each<TemplateCase>([
            ['a server value a local of the body holds', 'export const Page = ({ a }) => { if (a) { const s = env.DB_PASSWORD; return <b onClick={() => go(s)}>x</b>; } return <div/>; };', { a: true }],
            ['an error caught from a server value', 'export const Page = () => { try { throw new Error(env.DB_PASSWORD); } catch (e) { return <b onClick={() => go(e.message)}>x</b>; } };', {}]
        ])('refuses %s, which client code would read as a declaration', (_how, source, props) => {
            expect(documentOf(source, props)).toBeUndefined();
        });

        it.each<TemplateCase>([
            ['a field of an imported array', 'export const Page = () => <ul>{env.rows.map(r => <li onClick={() => go(r.id)}>x</li>)}</ul>;', {}],
            ['an imported config', 'export const Page = () => <div>{env.oauthProviders.map(p => <button onClick={() => go(p.id)}>{p.id}</button>)}</div>;', {}]
        ])('writes only the fields the handler reads from %s', (_how, source, props) => {
            expect(documentOf(source, props)).not.toContain(SECRET);
        });

        it.each<TemplateCase>([
            ['an import through a loop', 'export const Page = () => <ul>{[env.DB_PASSWORD].map(p => <li onClick={() => go(p)}>x</li>)}</ul>;', {}],
            ['a secret field the handler reads', 'export const Page = () => <ul>{env.rows.map(r => <li onClick={() => go(r.password)}>x</li>)}</ul>;', {}],
            ['an imported config passed on whole', 'export const Page = () => <div>{env.oauthProviders.map(p => <button onClick={() => go(p)}>{p.id}</button>)}</div>;', {}],
            ['an import held by a local of the loop', 'export const Page = ({ items }) => <ul>{items.map(i => { const s = env.DB_PASSWORD; return <li onClick={() => go(s, i)}>x</li>; })}</ul>;', { items: [1] }],
            ['process.env through a loop', `export const Page = () => <ul>{[process.env.${SECRET_VARIABLE}].map(p => <li onClick={() => go(p)}>x</li>)}</ul>;`, {}],
            ['a module-level constant through a loop', `const M = '${SECRET}';\nexport const Page = () => <ul>{[M].map(p => <li onClick={() => go(p)}>x</li>)}</ul>;`, {}],
            ['a parameter of a helper in the body', 'export const Page = () => { const row = (u) => <li onClick={() => go(u)}>x</li>; return <ul>{row(env.DB_PASSWORD)}</ul>; };', {}],
            ['a for...of over an import in a helper', 'export const Page = () => { function rows() { const out = []; for (const r of env.rows) { out.push(<li onClick={() => go(r.password)}>x</li>); } return out; } return <ul>{rows()}</ul>; };', {}],
            ['a function invoked in the markup', 'export const Page = () => <div>{(() => { const s = env.DB_PASSWORD; return <b onClick={() => go(s)}>x</b>; })()}</div>;', {}],
            ['an import captured by a function prop', 'const Inner = () => <div/>;\nexport const Page = () => <ul>{[env.DB_PASSWORD].map(p => <Inner f={() => p}/>)}</ul>;', {}]
        ])('writes %s into the page as the handler reads it', (_how, source, props) => {
            expect(documentOf(source, props)).toContain(SECRET);
        });
    });

    describe('source of the component client code does not read', () => {
        const cases: TemplateCase[] = [
            ['the default of a prop client code does not read', `export const Page = ({ apiKey = '${SECRET}', label }) => <button onClick={() => go(label)}>x</button>;`, { label: 'l' }],
            ['a nested default client code does not read', `export const Page = ({ cfg: { k = '${SECRET}' } = {}, label }) => <button onClick={() => go(label)}>x</button>;`, { label: 'l' }],
            ['the default of a prop only onServer reads', `export const Page = ({ apiKey = '${SECRET}', label }) => { onServer(() => { console.log(apiKey); }); return <button onClick={() => go(label)}>x</button>; };`, { label: 'l' }],
            ['an onServer block in a handler', `export const Page = () => <button onClick={() => { onServer(() => { console.log('${SECRET}'); }); go(); }}>x</button>;`, {}],
            ['a captured value only an onServer block in a handler reads', 'export const Page = ({ users }) => <ul>{users.map(u => <li onClick={() => { onServer(() => { console.log(u); }); go(); }}>x</li>)}</ul>;', { users: [{ password: SECRET }] }],
            ['an onServer block inside a helper client code calls', `export const Page = () => { function h() { onServer(() => { console.log('${SECRET}'); }); go(); } return <button onClick={() => h()}>x</button>; };`, {}],
            ['an onServer block inside onClient', `export const Page = () => { onClient(() => { onServer(() => { console.log('${SECRET}'); }); }); return <div/>; };`, {}],
            ['an onServer block in an initializer', `export const Page = () => { const v = onServer(() => '${SECRET}'); return <button onClick={() => go(v)}>x</button>; };`, {}],
            ['a local only onServer reads', `export const Page = () => { const k = '${SECRET}'; onServer(() => { console.log(k); }); return <button onClick={() => go(1)}>x</button>; };`, {}],
            ['a statement beside onClient in control flow', `export const Page = ({ a }) => { if (a) { console.log('${SECRET}'); onClient(() => { go(1); }); } return <div/>; };`, { a: 1 }],
            ['a comment in client code', `export const Page = () => <button onClick={() => { /* ${SECRET} */ go(1); }}>x</button>;`, {}],
            ['markup client code reads', `export const Page = () => { const el = <div>${SECRET}</div>; return <button onClick={() => go(el)}>x</button>; };`, {}]
        ];

        it.each(cases)('does not write %s into the page', (_how, source, props) => {
            expect(documentOf(source, props) ?? '').not.toContain(SECRET);
        });
    });

    describe('the source of the component around its client code', () => {
        // Client code keeps the control flow and the declarations around it, as written: the author's
        // own source. A declaration that read an import would be refused with it.
        const cases: TemplateCase[] = [
            ['the condition of an early return', `export const Page = ({ token }) => { if (token !== '${SECRET}') { return <p>no</p>; } onClient(() => { go(1); }); return <div/>; };`, { token: 'other' }],
            ['the condition around onClient', `export const Page = ({ t }) => { if (t === '${SECRET}') { onClient(() => { go(1); }); } return <div/>; };`, { t: 'other' }],
            ['the case around onClient', `export const Page = ({ t }) => { switch (t) { case '${SECRET}': { onClient(() => { go(1); }); break; } } return <div/>; };`, { t: 'other' }],
            ['a throw beside onClient', `export const Page = ({ t }) => { if (t) { if (t === 1) { throw new Error('${SECRET}'); } onClient(() => { go(1); }); } return <div/>; };`, { t: 2 }],
            ['a field client code does not read of an object it does', `export const Page = () => { const cfg = { pub: 'a', key: '${SECRET}' }; return <button onClick={() => go(cfg.pub)}>x</button>; };`, {}]
        ];

        it.each(cases)('writes %s into the page as written', (_how, source, props) => {
            expect(documentOf(source, props)).toContain(SECRET);
        });
    });

    describe('props client code does not read', () => {
        it.each<TemplateCase>([
            ['a prop only the markup reads', 'export const Page = ({ account, label }) => <button onClick={() => go(label)} title={account.name}>x</button>;', { account: { name: 'n', apiToken: SECRET }, label: 'l' }],
            ['a field next to the one client code reads', 'export const Page = ({ account }) => <button onClick={() => go(account.name)}>x</button>;', { account: { name: 'n', apiToken: SECRET } }],
            ['a prop named apart from a rest client code reads a field of', 'export const Page = ({ secret, ...rest }) => <button onClick={() => go(rest.label)}>x</button>;', { secret: SECRET, label: 'l' }],
            ['a field a destructuring of a local names', 'export const Page = ({ user }) => { const { password, id } = user; onClient(() => { go(id); }); return <div/>; };', { user: { id: 1, password: SECRET } }],
            ['a field a destructuring in a loop names', 'export const Page = ({ users }) => { onClient(() => { for (const { password, id } of users) { go(id); } }); return <div/>; };', { users: [{ id: 1, password: SECRET }] }],
            ['a field a destructuring in a callback names', 'export const Page = ({ users }) => { onClient(() => { go(users.map(({ password, id }) => id)); }); return <div/>; };', { users: [{ id: 1, password: SECRET }] }],
            ['a field a destructured loop value names', 'export const Page = ({ users }) => <ul>{users.map(({ password, id }) => <li onClick={() => go(id)}>x</li>)}</ul>;', { users: [{ id: 1, password: SECRET }] }]
        ])('does not write %s into the page', (_how, source, props) => {
            expect(documentOf(source, props) ?? '').not.toContain(SECRET);
        });

        // Taking a value out with a rest is how a template says the value is not for the client, so the
        // rest being read whole does not make the value read.
        const rests: [...TemplateCase, kept: string][] = [
            ['a prop', 'export const Page = ({ secret, ...rest }) => <button onClick={() => go(rest)}>x</button>;', { secret: SECRET, label: 'l' }, '"label":"l"'],
            ['a prop only onServer reads', 'export const Page = ({ secret, ...rest }) => { onServer(() => { console.log(secret); }); return <button onClick={() => go(rest)}>x</button>; };', { secret: SECRET, label: 'l' }, '"label":"l"'],
            ['a field of a prop', 'export const Page = ({ user: { password, ...safe } }) => <button onClick={() => go(safe)}>x</button>;', { user: { id: 1, password: SECRET } }, '"id":1'],
            ['a field of a local', 'export const Page = ({ user }) => { const { password, ...safe } = user; onClient(() => { go(safe); }); return <div/>; };', { user: { id: 1, password: SECRET } }, '"id":1'],
            ['a field of a rest', 'export const Page = ({ user }) => { const { password, ...others } = user; const { apiToken, ...safe } = others; onClient(() => { go(safe); }); return <div/>; };', { user: { id: 1, password: SECRET, apiToken: SECRET } }, '"id":1'],
            ['a prop next to one client code reads', 'export const Page = ({ label, secret, ...rest }) => <button onClick={() => go(label, rest)}>x</button>;', { label: { text: 't' }, secret: SECRET, other: 'o' }, '"text":"t"'],
            ['a field of a loop value', 'export const Page = ({ users }) => <ul>{users.map(({ password, ...safe }) => <li onClick={() => go(safe)}>x</li>)}</ul>;', { users: [{ id: 1, password: SECRET }] }, '"id":1']
        ];

        it.each(rests)('does not write %s taken out with a rest into the page', (_how, source, props, kept) => {
            const document: string | undefined = documentOf(source, props);

            expect(document).not.toContain(SECRET);
            expect(document).toContain(kept);
        });

        it('does not write what an object serializes beside the field client code reads', () => {
            const account: Record<string, unknown> = {
                name: 'Acme',
                apiToken: SECRET,
                toJSON: () => ({ name: 'Acme', apiToken: SECRET })
            };
            const document: string | undefined = documentOf(
                'export const Page = ({ account }) => <button onClick={() => go(account.name)}>x</button>;',
                { account }
            );

            expect(document).toContain('Acme');
            expect(document).not.toContain(SECRET);
        });
    });

    describe('the value a handler is handed', () => {
        // A value of the server reaches the page in exactly one way: the author hands it to client code in
        // the template's own source, and the render writes as much of it as that code reads. Handing a
        // value to a handler is the author's deliberate act, the same as passing it into the component as a
        // prop, and the compiler does not second-guess it (GOALS.md, "What is the author's").

        const providers: Record<string, unknown>[] = [{ name: 'Google', clientId: 'public-client-id', clientSecret: SECRET }];

        /**
         * A login page listing the providers of a server module, each with a handler reading the provider
         * the given way.
         * @param read - What the handler passes on: `provider` or a field of it.
         * @returns The document.
         */
        function loginPageReading(read: string): string | undefined {
            return renderTemplateDocument(
                'import { oauthProviders } from \'./environment\';\n'
                + 'declare const startLogin: (provider: unknown) => void;\n'
                + 'export const Page = () => <ul>{oauthProviders.map(provider => '
                + `<li><button onClick={() => startLogin(${read})}>{provider.name}</button></li>`
                + ')}</ul>;',
                { './environment': { oauthProviders: providers } }
            );
        }

        it('writes the fields the handler reads of a server value the markup hands it through a loop', () => {
            // `provider` is a local of the loop, captured by the handler; the render writes it into the
            // page narrowed to the field read.
            const document: string | undefined = loginPageReading('provider.clientId');

            expect(document).toContain('public-client-id');
            expect(document).not.toContain(SECRET);
        });

        it('writes a server value whole when the handler passes it on whole', () => {
            const document: string | undefined = loginPageReading('provider');

            expect(document).toContain('"clientId":"public-client-id"');
            expect(document).toContain(SECRET);
        });

        it('writes a value that reached the component as the default of a context the same way', () => {
            // The context was created in a `.ts` file with the whole environment as its default, which the
            // compiler never sees; `useContext` runs on the server and hands the component the default.
            // From there on it is the case above: what the page gets is decided by the handler.
            const document: string | undefined = renderTemplateDocument(
                'import { useContext } from \'zibri\';\n'
                + 'import { AppConfig } from \'./app-config\';\n'
                + 'declare const startLogin: (provider: unknown) => void;\n'
                + 'export const Page = () => { const config = useContext(AppConfig); '
                + 'return <ul>{config.oauthProviders.map(provider => '
                + '<li><button onClick={() => startLogin(provider)}>{provider.name}</button></li>'
                + ')}</ul>; };',
                { zibri: SERVER_HOOKS, './app-config': { AppConfig: createContext({ oauthProviders: providers }) } }
            );

            expect(document).toContain('Google');
            expect(document).toContain(SECRET);
        });
    });
});