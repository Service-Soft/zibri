import { describe, expect, it } from '@jest/globals';

import { compile, CompileResult } from './compile';
import { compilePage } from '../__testing__/server-render.helper';
import { renderPage } from '../runtime/render-page';
import { ValidationCode } from '../semantics/validate';

/**
 * Compiles a template and returns its first component's client script, asserting it compiled cleanly.
 * @param source - The template source.
 * @returns The client script, or an empty string when there is none.
 */
function clientScriptOf(source: string): string {
    const result: CompileResult = compile(source);
    expect(result.diagnostics).toEqual([]);
    return result.client?.code ?? '';
}

describe('syntax inside components', () => {
    describe('do...while and for...in', () => {
        it('renders both loops on the server', () => {
            const page: string = renderPage(compilePage(
                'const Home = ({ flags }) => { const names = []; for (const name in flags) { names.push(name); } '
                + 'let rounds = 0; do { rounds++; } while (rounds < 2); return <p>{names.join(\',\')}:{rounds}</p>; };'
            ), { flags: { a: true, b: false } });

            expect(page).toContain('<p>a,b:2</p>');
        });

        it('keeps client code inside for...in and leaves out what it does not read', () => {
            const result: CompileResult = compile(
                'export const Home = ({ flags }) => { for (const name in flags) { const internal = \'SECRET-IN-LOOP\'; '
                + 'onClient(() => { console.log(name); }); } return <div/>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.code).toContain('for (const name in flags)');
            expect(result.client?.code).not.toContain('SECRET-IN-LOOP');
            expect(result.client?.referencedProps).toEqual(['flags']);
        });

        it('keeps client code inside do...while', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { let tries = 0; do { tries++; onClient(() => { console.log(tries); }); } '
                + 'while (tries < 2); return <div/>; };'
            );

            expect(script).toContain('do {');
            expect(script).toContain('while (tries < 2)');
        });

        it('captures the variable of a for...in loop in a handler', () => {
            const result: CompileResult = compile(
                'export const Home = ({ flags }) => { const items = []; for (const name in flags) { '
                + 'items.push(<li onClick={() => console.log(name)}>x</li>); } return <ul>{items}</ul>; };'
            );

            expect(result.diagnostics).toEqual([]);
            expect(result.client?.handlerSites.map(site => site.captureVars)).toEqual([['name']]);
        });
    });

    describe('classes', () => {
        it('renders a class declared in the body on the server', () => {
            const page: string = renderPage(compilePage(
                'const Home = ({ start }) => { class Counter { count = start; #step = 2; '
                + 'next() { this.count += this.#step; return this.count; } get twice() { return this.count * 2; } } '
                + 'const counter = new Counter(); counter.next(); return <p>{counter.count}/{counter.twice}</p>; };'
            ), { start: 1 });

            expect(page).toContain('<p>3/6</p>');
        });

        it('ships a class client code uses, and leaves out one it does not', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { class Unused { static key = \'SECRET-CLASS\'; } '
                + 'class Counter { count = 0; increment() { this.count++; console.log(this.count); } } '
                + 'return <button onClick={() => new Counter().increment()}>x</button>; };'
            );

            expect(script).toContain('class Counter');
            expect(script).not.toContain('SECRET-CLASS');
        });

        it('refuses a server import read inside a class method of client code', () => {
            const result: CompileResult = compile(
                'import { secret } from \'./secrets\';\n'
                + 'export const Home = () => { class Reader { read() { return secret; } } '
                + 'return <button onClick={() => console.log(new Reader().read())}>x</button>; };'
            );

            expect(result.code).toBeUndefined();
            expect(result.diagnostics.map(d => d.code)).toEqual([ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE]);
        });

        it('reads what a class expression, its heritage and its static block reference', () => {
            const result: CompileResult = compile(
                'import { Base, seed } from \'./base\';\n'
                + 'export const Home = () => { onClient(() => { const Box = class extends Base { static { console.log(seed); } }; '
                + 'console.log(Box); }); return <div/>; };'
            );

            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('\'Base\'');
            expect(result.diagnostics.map(d => d.message).join('\n')).toContain('\'seed\'');
        });
    });

    describe('syntax newer than the emitted language version', () => {
        // Emitted code targets ES2022, which Node and current browsers run; newer syntax is lowered.

        it('renders a decorated class on the server', () => {
            const page: string = renderPage(compilePage(
                'const Home = () => { function upper(method) { return function () { return method.call(this).toUpperCase(); }; } '
                + 'class Greeter { @upper greet() { return \'hi\'; } } return <p>{new Greeter().greet()}</p>; };'
            ));

            expect(page).toContain('<p>HI</p>');
        });

        it('lowers decorators and using declarations in client code', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { function logged(method) { return method; } '
                + 'class Job { @logged run() { using handle = { [Symbol.dispose]() { console.log(\'done\'); } }; return handle; } } '
                + 'return <button onClick={() => new Job().run()}>x</button>; };'
            );

            expect(script).toContain('class Job');
            expect(script).not.toContain('@logged');
            expect(script).not.toContain('using handle');
        });
    });

    describe('other syntax', () => {
        it('ships an object getter and setter client code uses', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { let value = 1; const box = { get current() { return value; }, set current(next) { value = next; } }; '
                + 'return <button onClick={() => { box.current = box.current + 1; }}>x</button>; };'
            );

            expect(script).toContain('get current()');
            expect(script).toContain('let value = 1;');
        });

        it('ships a generator client code uses', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { function* ids(limit) { for (let i = 0; i < limit; i++) { yield i; } } '
                + 'return <button onClick={() => console.log([...ids(3)])}>x</button>; };'
            );

            expect(script).toContain('function* ids(limit)');
        });

        it('ships an enum client code uses', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { enum Mode { Light = \'light\', Dark = \'dark\' } '
                + 'return <button onClick={() => console.log(Mode.Dark)}>x</button>; };'
            );

            expect(script).toContain('let Mode;');
            expect(script).toContain('"dark"');
        });

        it('reads the computed key of a destructuring pattern and of a method', () => {
            const result: CompileResult = compile(
                'import { field, method } from \'./keys\';\n'
                + 'export const Home = ({ record }) => { onClient(() => { const { [field]: value } = record; '
                + 'const api = { [method]() { return value; } }; console.log(api); }); return <div/>; };'
            );

            const messages: string = result.diagnostics.map(d => d.message).join('\n');
            expect(messages).toContain('\'field\'');
            expect(messages).toContain('\'method\'');
        });

        it('compiles a private name check', () => {
            const script: string = clientScriptOf(
                'export const Home = () => { class Tag { #brand = true; static is(value) { return #brand in value; } } '
                + 'return <button onClick={() => console.log(Tag.is({}))}>x</button>; };'
            );

            expect(script).toContain('#brand in value');
        });
    });
});