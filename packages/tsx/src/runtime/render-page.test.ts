import assert from 'node:assert';

import { describe, expect, it, jest } from '@jest/globals';

import { CompiledPage, LocaleData, renderPage, wrapDocument } from './render-page';
import { createContext } from './server-runtime';
import { compilePage, renderTemplateDocument, renderTestPage } from '../../../tsx-compiler/src/__testing__/server-render.helper';

// --- minimal DOM stub -------------------------------------------------------

class FakeElement {
    private readonly listeners: Record<string, (() => void)[]> = {};

    constructor(private readonly stamp: string) {}

    getAttribute(name: string): string | null {
        return name === 'data-ssr' ? this.stamp : null;
    }

    addEventListener(event: string, fn: () => void): void {
        (this.listeners[event] ??= []).push(fn);
    }

    fire(event: string): void {
        for (const fn of this.listeners[event] ?? []) {
            fn();
        }
    }
}

function scriptBodyOf(document: string): string {
    const match: RegExpMatchArray | null = document.match(/<script[^>]*>\n([\S\s]*?)\n<\/script>/);
    assert(match, 'expected an injected script');
    return match[1];
}

function elementsFrom(html: string): FakeElement[] {
    return [...html.matchAll(/data-ssr="([^"]+)"/g)].map(m => new FakeElement(m[1]));
}

function runScript(body: string, elements: FakeElement[], globals: Record<string, unknown>): void {
    // eslint-disable-next-line typescript/typedef
    const fakeDocument = { querySelectorAll: (): FakeElement[] => elements };
    const fakeWindow: Record<string, unknown> = {};
    const names: string[] = Object.keys(globals);
    // eslint-disable-next-line typescript/no-implied-eval
    const run: (...args: unknown[]) => void = new Function(
        'document', 'window', 'console', ...names, body
    ) as (...args: unknown[]) => void;
    run(fakeDocument, fakeWindow, console, ...names.map(n => globals[n]));
}

describe('wrapDocument', () => {
    it('prefixes the doctype and appends the script when there is no body tag', () => {
        const out: string = wrapDocument('<div>x</div>', 'doStuff();');
        expect(out.startsWith('<!DOCTYPE html>\n')).toBe(true);
        expect(out).toContain('<script>\ndoStuff();\n</script>');
    });

    it('injects the script before a closing body tag', () => {
        const out: string = wrapDocument('<html><body><p>x</p></body></html>', 'doStuff();');
        expect(out).toContain('<p>x</p><script>\ndoStuff();\n</script>\n</body>');
    });

    it('applies a CSP nonce', () => {
        expect(wrapDocument('<div/>', 'x();', 'abc123')).toContain('<script nonce="abc123">');
    });

    it('neutralizes a closing script tag inside the code', () => {
        const out: string = wrapDocument('<div/>', 'const s = "</script>";');
        expect(out).toContain('<\\/script>');
        expect(out.match(/<\/script>/g)).toHaveLength(1);
    });

    it('neutralizes a closing script tag inside the code, whatever its case and whatever follows the name', () => {
        // an html parser ends a script on `</script` followed by whitespace, `/` or `>`, in any case
        const out: string = wrapDocument('<div/>', 'const a = "</SCRIPT>"; const b = "</Script >"; const c = "</script/";');
        expect(out.match(/<\/script/gi)).toHaveLength(1);
    });

    it('omits the script entirely when there is no client behavior', () => {
        expect(wrapDocument('<div>x</div>', '')).toBe('<!DOCTYPE html>\n<div>x</div>');
    });

    it('preserves dollar-sign sequences in the injected code', () => {
        // `$$`, `$&`, `$1` are replacement patterns for String.replace and must survive verbatim.
        const code: string = 'const a$$b = "$& $1 $\'"; run(a$$b);';
        const out: string = wrapDocument('<html><body></body></html>', code);
        expect(out).toContain(code);
    });
});

describe('renderPage', () => {
    it('renders a static page without a script', () => {
        const page: CompiledPage = compilePage('const Home = () => <html><body><h1>Hi</h1></body></html>;');
        const out: string = renderTestPage(page);
        expect(out).toBe('<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>');
    });

    it('serializes only the props the client references', () => {
        const source: string = 'const Home = ({ shown, secret }) => { '
            + 'onClient(() => { track(shown); }); return <div>{secret}</div>; };';
        const out: string = renderTestPage(compilePage(source), { shown: 'yes', secret: 'do-not-leak' });
        const body: string = scriptBodyOf(out);
        expect(body).toContain('"shown":"yes"');
        expect(body).not.toContain('do-not-leak');
    });

    it('keeps a prop holding a closing script tag inside the script, and hands it to the client as it was', () => {
        const hostile: string = '</SCRIPT><img src=x onerror=alert(1)></script ><!--<script>';
        const source: string = 'const Home = ({ name }) => { onClient(() => { track(name); }); return <div/>; };';
        const out: string = renderTestPage(compilePage(source), { name: hostile });

        // the one closing tag is the script's own: a prop is a user's name or a comment, and anything
        // closing the script early turns the rest of it into markup
        expect(out.match(/<\/script/gi)).toHaveLength(1);
        const tracked: unknown[] = [];
        runScript(scriptBodyOf(out), [], { track: (value: unknown) => tracked.push(value) });
        expect(tracked).toEqual([hostile]);
    });

    it('keeps a translation holding a closing script tag inside the script', () => {
        const source: string = 'const Home = () => { onClient(() => { show($ts`hello`); }); return <div/>; };';
        const localeData: LocaleData = { locale: 'de', translations: { de: { hello: '</Script><b>' } }, formatOptions: {} };
        const out: string = renderTestPage(compilePage(source), {}, { localeData });
        expect(out.match(/<\/script/gi)).toHaveLength(1);
    });

    it('inlines the $ts hook with the render-time locale data', () => {
        const source: string = 'const Home = () => { onClient(() => { show($ts`hello`); }); return <div/>; };';
        const localeData: LocaleData = {
            locale: 'de',
            translations: { de: { hello: 'hallo' } },
            formatOptions: {}
        };
        const body: string = scriptBodyOf(renderTestPage(compilePage(source), {}, { localeData }));
        expect(body).toContain('const $t =');
        expect(body).toContain('const $ts =');
        expect(body).toContain('"hallo"');
        expect(body).toContain('"de"');
    });

    it('inlines only the translation strings the client looks up, for every locale', () => {
        const source: string = 'const Home = () => { onClient(() => { show($ts`used`); }); return <div/>; };';
        const localeData: LocaleData = {
            locale: 'de',
            translations: {
                de: { used: 'benutzt', unused: 'unbenutzt' },
                en: { used: 'used up', unused: 'not used' }
            },
            formatOptions: {}
        };
        const body: string = scriptBodyOf(renderTestPage(compilePage(source), {}, { localeData }));

        // Both locales stay, because a $t token can be resolved for any of them.
        expect(body).toContain('"benutzt"');
        expect(body).toContain('"used up"');
        // The strings the page never asks for are dropped.
        expect(body).not.toContain('unbenutzt');
        expect(body).not.toContain('not used');
    });

    it('keeps the full table when a source string cannot be resolved at compile time', () => {
        // $t names the placeholder after the runtime value's key, so narrowing would be unsound.
        const source: string = 'const Home = ({ params }) => { onClient(() => { show($ts`hi ${params}`); }); '
            + 'return <div/>; };';
        const localeData: LocaleData = {
            locale: 'de',
            translations: { de: { 'hi {name}': 'hallo {name}' } },
            formatOptions: {}
        };
        const body: string = scriptBodyOf(renderTestPage(compilePage(source), { params: { name: 'Tim' } }, { localeData }));

        expect(body).toContain('hallo {name}');
    });

    it('unions the strings of every rendered component', () => {
        const child: string = 'const Child = () => { onClient(() => { show($ts`from child`); }); return <span/>; };';
        const page: string = 'const Page = () => { onClient(() => { show($ts`from page`); }); '
            + 'return <div><Child/></div>; };';
        const localeData: LocaleData = {
            locale: 'de',
            translations: { de: { 'from child': 'vom kind', 'from page': 'von der Seite', other: 'anderes' } },
            formatOptions: {}
        };
        const body: string = scriptBodyOf(renderTestPage(compilePage(page, { Child: child }), {}, { localeData }));

        expect(body).toContain('"vom kind"');
        expect(body).toContain('"von der Seite"');
        expect(body).not.toContain('anderes');
    });

    it('defines a nested component setup once and calls it per instance with its own props', () => {
        const chart: string = 'const Chart = ({ canvasId }) => { onClient(() => { init(canvasId); }); '
            + 'return <canvas id={canvasId}></canvas>; };';
        const page: string = 'const Page = () => <html><body><Chart canvasId="a"/><Chart canvasId="b"/></body></html>;';
        const out: string = renderTestPage(compilePage(page, { Chart: chart }));
        const body: string = scriptBodyOf(out);

        expect(body.match(/function Chart\$\$setup/g)).toHaveLength(1);
        expect(body).toMatch(/__zibriRunSetup\(\(\) => Chart\$\$setup\$[\da-f]{12}\({"canvasId":"a"}, {"owner":1,"handlers":\[],"props":\[],"refs":{},"states":{}}\)\);/);
        expect(body).toMatch(/__zibriRunSetup\(\(\) => Chart\$\$setup\$[\da-f]{12}\({"canvasId":"b"}, {"owner":2,"handlers":\[],"props":\[],"refs":{},"states":{}}\)\);/);

        const initialized: string[] = [];
        runScript(body, [], { init: (v: string) => initialized.push(v) });
        expect(initialized).toEqual(['a', 'b']);
    });

    it('isolates each nested instance\'s locals without renaming', () => {
        const counter: string = 'const Counter = ({ id, start }) => { onClient(() => { let count = start; report(id, count); }); '
            + 'return <span id={id}></span>; };';
        const page: string = 'const Page = () => <div><Counter id="x" start={1}/><Counter id="y" start={9}/></div>;';
        const seen: [string, number][] = [];
        runScript(
            scriptBodyOf(renderTestPage(compilePage(page, { Counter: counter }))),
            [],
            { report: (id: string, n: number) => seen.push([id, n]) }
        );
        expect(seen).toEqual([['x', 1], ['y', 9]]);
    });

    it('emits vendor script tags into the head for ?client packages of rendered components', () => {
        const chart: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Chart_ = ({ id }) => { onClient(() => { new Chart(id); }); return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = () => <html><head><title>t</title></head><body><Chart_ id="a"/></body></html>;';
        const out: string = renderTestPage(compilePage(page, { Chart_: chart }));

        expect(out).toContain('<script src="/assets/vendor/chart-js.js"></script>');
        // The vendor tag must be in the head, i.e. before the client script near </body>.
        expect(out.indexOf('chart-js.js')).toBeLessThan(out.indexOf('Chart_$$setup'));
    });

    it('honours a custom vendor url prefix and emits each package once', () => {
        const chart: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Chart_ = ({ id }) => { onClient(() => { new Chart(id); }); return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = () => <html><head></head><body><Chart_ id="a"/><Chart_ id="b"/></body></html>;';
        const out: string = renderTestPage(compilePage(page, { Chart_: chart }), {}, { vendorUrlPrefix: '/static/v' });

        expect(out).toContain('<script src="/static/v/chart-js.js"></script>');
        expect(out.match(/chart-js\.js/g)).toHaveLength(1);
    });

    it('resolves a renamed ?client import against the vendor global', () => {
        // The bundle only exposes `Chart`, so the local name has to be bound to it.
        const chart: string = 'import { Chart as ChartJsChart } from \'chart.js?client\';\n'
            + 'export const Chart_ = ({ id }) => { onClient(() => { new ChartJsChart(id); }); return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = () => <html><body><Chart_ id="a"/></body></html>;';
        const built: string[] = [];
        class FakeChart {
            constructor(id: string) {
                built.push(id);
            }
        }

        runScript(scriptBodyOf(renderTestPage(compilePage(page, { Chart_: chart }))), [], { Chart: FakeChart });
        expect(built).toEqual(['a']);
    });

    it('emits no vendor tags when no component needs a client package', () => {
        const out: string = renderTestPage(compilePage('const Page = () => <html><head></head><body>hi</body></html>;'));
        expect(out).not.toContain('/assets/vendor/');
    });

    it('emits the handler registry and wires interactivity end to end', () => {
        const button: string = 'const Button = ({ onClick, children }) => <button onClick={onClick}>{children}</button>;';
        const page: string = 'const Home = ({ label }) => { function pick() { chose(label); } '
            + 'return <html><body><Button onClick={pick}>Go</Button></body></html>; };';
        const out: string = renderTestPage(compilePage(page, { Button: button }), { label: 'ok' }, { nonce: 'n1' });

        expect(out).toContain('<script nonce="n1">');
        expect(out).toContain('data-ssr="h0_0:click"');

        const elements: FakeElement[] = elementsFrom(out);
        expect(elements).toHaveLength(1);
        let chosen: string | undefined;
        runScript(scriptBodyOf(out), elements, {
            chose: (v: string) => {
                chosen = v;
            }
        });
        elements[0].fire('click');
        expect(chosen).toBe('ok');
    });

    it.each([
        ['the props whole', 'const Home = (props) => <button onClick={() => chose(props.label)}>x</button>;'],
        ['a renamed prop', 'const Home = ({ label: text }) => <button onClick={() => chose(text)}>x</button>;'],
        ['a prop destructured further', 'const Home = ({ item: { label } }) => <button onClick={() => chose(label)}>x</button>;']
    ])('hands the client a prop it reads through %s', (_how, page) => {
        const out: string = renderTestPage(compilePage(page), { label: 'ok', item: { label: 'ok', secret: 'SECRET-NEVER-IN-PAGE' } });
        const elements: FakeElement[] = elementsFrom(out);
        let chosen: string | undefined;
        runScript(scriptBodyOf(out), elements, {
            chose: (v: string) => {
                chosen = v;
            }
        });
        elements[0].fire('click');

        expect(chosen).toBe('ok');
        expect(out).not.toContain('SECRET-NEVER-IN-PAGE');
    });

    it('hands the client every prop when it uses the props whole', () => {
        const out: string = renderTestPage(
            compilePage('const Home = (props) => <button onClick={() => chose(JSON.stringify(props))}>x</button>;'),
            { label: 'ok', count: 2 }
        );
        const elements: FakeElement[] = elementsFrom(out);
        let chosen: string | undefined;
        runScript(scriptBodyOf(out), elements, {
            chose: (v: string) => {
                chosen = v;
            }
        });
        elements[0].fire('click');

        expect(chosen).toBe('{"label":"ok","count":2}');
    });

    it('hands a nested component a prop it reads under another name', () => {
        const button: string = 'const Button = ({ label: text, user: { id } }) => <button onClick={() => picked(text, id)}>x</button>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Button label="a" user={{ id: \'u1\', secret: \'SECRET-NEVER-IN-PAGE\' }}/>;', { Button: button }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (...values: string[]) => picked.push(...values) });
        elements[0].fire('click');

        expect(picked).toEqual(['a', 'u1']);
        expect(out).not.toContain('SECRET-NEVER-IN-PAGE');
    });

    it('attaches a handler once per element when a component is rendered several times', () => {
        // Every instance runs the same setup, and each run sees the whole document — so an instance
        // must only wire up the elements that belong to it.
        const button: string = 'const Button = ({ id }) => <button onClick={() => picked(id)}>x</button>;';
        const page: string = 'const Page = () => <div><Button id="a"/><Button id="b"/></div>;';
        const out: string = renderTestPage(compilePage(page, { Button: button }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');
        elements[1].fire('click');
        expect(picked).toEqual(['a', 'b']);
    });

    it('hands a function prop to the nested component that calls it', () => {
        // The function belongs to the parent's scope (it closes over `factor`), so it is built in the
        // parent's setup and handed to the child rather than serialized into the page.
        const chart: string = 'const Chart = ({ id, update }) => { onClient(() => { register(id, update); }); '
            + 'return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = ({ factor }) => { function scale(n) { return n * factor; } '
            + 'return <div><Chart id="a" update={scale}/></div>; };';
        const registered: Record<string, (n: number) => number> = {};
        const body: string = scriptBodyOf(renderTestPage(compilePage(page, { Chart: chart }), { factor: 3 }));

        runScript(body, [], {
            register: (id: string, update: (n: number) => number) => {
                registered[id] = update;
            }
        });
        expect(registered['a'](5)).toBe(15);
    });

    it('gives each instance the function its own parent built', () => {
        const chart: string = 'const Chart = ({ id, update }) => { onClient(() => { register(id, update); }); '
            + 'return <canvas id={id}></canvas>; };';
        const row: string = 'const Row = ({ label }) => { function describe() { return \'row \' + label; } '
            + 'return <Chart id={label} update={describe}/>; };';
        const page: string = 'const Page = () => <div><Row label="a"/><Row label="b"/></div>;';
        const registered: Record<string, () => string> = {};
        const body: string = scriptBodyOf(renderTestPage(compilePage(page, { Chart: chart, Row: row })));

        runScript(body, [], {
            register: (id: string, update: () => string) => {
                registered[id] = update;
            }
        });
        expect(registered['a']()).toBe('row a');
        expect(registered['b']()).toBe('row b');
    });

    it('builds an object prop containing a function on the client, closing over the parent props', () => {
        // Serializing the config would drop `format` silently, so the whole object is built in the
        // parent's setup instead - which means the props it reads have to travel with it.
        const chart: string = 'const Chart = ({ id, config }) => { onClient(() => { register(id, config); }); '
            + 'return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = ({ unit }) => <div><Chart id="a" config={{ type: \'bar\', '
            + 'ticks: { format: (v) => v + unit } }}/></div>;';
        const registered: Record<string, { type: string, ticks: { format: (v: number) => string } }> = {};
        const body: string = scriptBodyOf(renderTestPage(compilePage(page, { Chart: chart }), { unit: ' KB' }));

        runScript(body, [], {
            register: (id: string, config: { type: string, ticks: { format: (v: number) => string } }) => {
                registered[id] = config;
            }
        });
        expect(registered['a'].type).toBe('bar');
        expect(registered['a'].ticks.format(12)).toBe('12 KB');
    });

    it('captures per-iteration values for a function prop created inside a loop', () => {
        const chart: string = 'const Chart = ({ id, update }) => { onClient(() => { register(id, update); }); '
            + 'return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = ({ rows }) => <div>{rows.map(row => <Chart id={row.id} update={() => row.id}/>)}</div>;';
        const registered: Record<string, () => string> = {};
        const rows: { id: string }[] = [{ id: 'x' }, { id: 'y' }];
        const body: string = scriptBodyOf(renderTestPage(compilePage(page, { Chart: chart }), { rows }));

        runScript(body, [], {
            register: (id: string, update: () => string) => {
                registered[id] = update;
            }
        });
        expect(registered['x']()).toBe('x');
        expect(registered['y']()).toBe('y');
    });

    it('carries what keeps state only on a page that uses state', () => {
        const without: string = renderTestPage(compilePage('const Page = () => <button onClick={() => picked()}>x</button>;'));
        const withState: string = renderTestPage(compilePage('const Page = () => { const count = useState(0); return <p>{count.value}</p>; };'));

        expect(without).not.toContain('__zibriState');
        expect(without).not.toContain('__zibriBind');
        expect(withState).toContain('function __zibriState');
        expect(withState).toContain('function __zibriBind');
    });

    it('looks through the document once, whatever number of instances attach handlers', () => {
        const button: string = 'const Button = ({ label }) => <button onClick={() => picked(label)}>{label}</button>;';
        const out: string = renderTestPage(compilePage('const Page = () => <div><Button label="a"/><Button label="b"/><Button label="c"/></div>;', { Button: button }));
        const elements: FakeElement[] = elementsFrom(out);
        const picked: string[] = [];
        let lookups: number = 0;
        const document: { querySelectorAll: () => FakeElement[] } = {
            querySelectorAll: () => {
                lookups++;
                return elements;
            }
        };

        Reflect.apply(
            // eslint-disable-next-line typescript/no-implied-eval
            new Function('document', 'console', 'picked', scriptBodyOf(out)),
            undefined,
            [document, console, (v: string) => picked.push(v)]
        );
        elements[2].fire('click');

        expect(lookups).toBe(1);
        expect(picked).toEqual(['c']);
    });

    it('hands a handler to the nested component that wraps it', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={() => onClick?.(\'wrapped\')}>x</button>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Button onClick={(v) => picked(v)}/>;', { Button: button }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');

        expect(picked).toEqual(['wrapped']);
    });

    it('gives a wrapped handler of a loop its own captured values, narrowed to what it reads', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={() => onClick?.()}>x</button>;';
        const page: string = 'const Page = ({ rows }) => <div>{rows.map(row => <Button onClick={() => picked(row.id)}/>)}</div>;';
        const rows: { id: string, secret: string }[] = [{ id: 'x', secret: 'SECRET-NEVER-IN-PAGE' }, { id: 'y', secret: 'SECRET-NEVER-IN-PAGE' }];
        const out: string = renderTestPage(compilePage(page, { Button: button }), { rows });
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[1].fire('click');
        elements[0].fire('click');

        expect(picked).toEqual(['y', 'x']);
        expect(out).not.toContain('SECRET-NEVER-IN-PAGE');
    });

    it('hands a handler through a component that only passes it on to one that wraps it', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={() => onClick?.()}>x</button>;';
        const toolbar: string = 'const Toolbar = ({ onClick }) => <Button onClick={onClick}/>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Toolbar onClick={() => picked(\'page\')}/>;', { Button: button, Toolbar: toolbar }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');

        expect(picked).toEqual(['page']);
    });

    it('hands a handler through a chain of components that each wrap it', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={() => onClick?.()}>x</button>;';
        const toolbar: string = 'const Toolbar = ({ onClick }) => <Button onClick={() => onClick?.()}/>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Toolbar onClick={() => picked(\'page\')}/>;', { Button: button, Toolbar: toolbar }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');

        expect(picked).toEqual(['page']);
    });

    it('still attaches a handler a component forwards as it is, and only once', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={onClick}>x</button>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Button onClick={() => picked(\'page\')}/>;', { Button: button }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');

        expect(picked).toEqual(['page']);
    });

    it('leaves a handler prop undefined when the parent passes none', () => {
        const button: string = 'const Button = ({ onClick }) => <button onClick={() => picked(typeof onClick)}>x</button>;';
        const out: string = renderTestPage(compilePage('const Page = () => <Button/>;', { Button: button }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');

        expect(picked).toEqual(['undefined']);
    });

    it('keeps components apart whose handler site ids collide', () => {
        // Site ids are allocated per component, so two components both start at `h0`.
        const button: string = 'const Button = () => <button onClick={() => picked(\'button\')}>x</button>;';
        const toggle: string = 'const Toggle = () => <input onChange={() => picked(\'toggle\')}/>;';
        const page: string = 'const Page = () => <div><Button/><Toggle/></div>;';
        const out: string = renderTestPage(compilePage(page, { Button: button, Toggle: toggle }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[1].fire('change');
        expect(picked).toEqual(['toggle']);
    });

    it('keeps two different components apart that share a name', () => {
        // Two files each declaring a `Card`, imported under different names by the page.
        const billingCard: string = 'const Card = () => <button onClick={() => picked(\'billing\')}>x</button>;';
        const profileCard: string = 'const Card = () => <button onClick={() => picked(\'profile\')}>x</button>;';
        const page: string = 'const Page = () => <div><BillingCard/><ProfileCard/></div>;';
        const out: string = renderTestPage(compilePage(page, { BillingCard: billingCard, ProfileCard: profileCard }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');
        elements[1].fire('click');
        expect(picked).toEqual(['billing', 'profile']);
    });
});

// a condition or a list that reads state is rendered again in the browser, which finds it between its markers
describe('markup the page renders again in the browser', () => {
    const list: string = 'const Page = () => { const todos = useState([{ id: \'a\', text: \'Write\' }, { id: \'a\', text: \'Read\' }]); '
        + 'return <ul>{todos.value.map(todo => <li key={todo.id}>{todo.text}</li>)}</ul>; };';

    it('renders only the branch that holds, between the markers the page finds it by', () => {
        const out: string = renderTestPage(compilePage('const Page = () => { const failed = useState(false); '
            + 'return <div>{failed.value ? <p>Failed</p> : <p>Fine {failed.value ? \'x\' : \'y\'}</p>}</div>; };'));

        expect(out).toMatch(/<div><!--r0_(\d+)--><p>Fine <!--\[-->y<!--\]--><\/p><!--\/r0_\1--><\/div>/);
        expect(out).not.toContain('Failed</p>');
    });

    it('throws for two rows with the same key, naming the key and the component', () => {
        expect(() => renderTestPage(compilePage(list))).toThrow(/'Page'[\S\s]*'a'/);
    });

    it('throws for two rows whose key is undefined, as the browser refuses them', () => {
        // a key read from a field the rows do not have
        const page: string = 'const Page = () => { const todos = useState([{ text: \'Write\' }, { text: \'Read\' }]); '
            + 'return <ul>{todos.value.map(todo => <li key={todo.id}>{todo.text}</li>)}</ul>; };';

        expect(() => renderTestPage(compilePage(page))).toThrow(/'Page'[\S\s]*'undefined'/);
    });

    it('renders a branch with a component that is not shown into a template the page copies', () => {
        const badge: string = 'const Badge = ({ label }) => <b class="badge">{label}</b>;';
        const out: string = renderTestPage(compilePage('const Page = () => { const open = useState(false); '
            + 'return <div>{open.value && <Badge label="New"/>}</div>; };', { Badge: badge }));

        expect(out).toMatch(/<div><!--r0_(\d+)--><!--\/r0_\1--><\/div>/);
        expect(out).toMatch(/<template data-zt="t\d+"><!--\{p\d+--><b class="badge">New<\/b><!--\}--><\/template>/);
    });

    it('renders the row of a list with a component into a template, leaving out what reads the row', () => {
        const label: string = 'const Label = ({ text }) => <b>{text}</b>;';
        const out: string = renderTestPage(compilePage('const Page = () => { const todos = useState([{ id: \'a\', text: \'Write\' }]); '
            + 'return <ul>{todos.value.map(todo => <li key={todo.id} title={todo.text}><Label text={todo.text}/></li>)}</ul>; };', { Label: label }));

        expect(out).toMatch(/<li title="Write"><!--\{p\d+--><b><!--(\w+)-->Write<!--\/\1--><\/b><!--\}--><\/li>/);
        expect(out).toMatch(/<template data-zt="t\d+"><li><!--\{p\d+--><b><!--(\w+)--><!--\/\1--><\/b><!--\}--><\/li><\/template>/);
    });

    it('throws for server code reading a value of the row while the server renders the markup the page copies', () => {
        const item: string = 'const Item = ({ todo }) => { const t = useInput(todo); const first = useState(t.value.text); return <li>{first.value}</li>; };';
        const page: string = 'const Page = () => { const todos = useState([{ id: \'a\', text: \'Write\' }]); '
            + 'return <ul>{todos.value.map(todo => <Item key={todo.id} todo={todo}/>)}</ul>; };';

        expect(() => renderTestPage(compilePage(page, { Item: item }))).toThrow(/'Item' reads the value of 't'/);
    });

    it('renders two rows with the same key in production, and logs it', () => {
        const { document, logged } = renderInProduction(compilePage(list));

        expect(document).toContain('<li><!--[-->Write<!--]--></li><li><!--[-->Read<!--]--></li>');
        expect(logged).toEqual([expect.stringMatching(/'a'/)]);
    });
});

// html has no value attribute for these: a textarea holds its value as its text, and a select marks the option
describe('the value of a textarea and a select', () => {
    it('renders the value of a textarea as its text', () => {
        const out: string = renderTestPage(compilePage('const Page = ({ note }) => <textarea id="note" value={note}/>;'), { note: 'a <b> & c' });

        expect(out).toContain('<textarea id="note">a &lt;b&gt; &amp; c</textarea>');
    });

    it.each([
        ['by its value', '<option value="a">A</option><option value="b">B</option>', '<option value="b" selected>B</option>'],
        ['by its text, without a value', '<option>a</option><option>b</option>', '<option selected>b</option>']
    ])('selects the option of the value of a select %s', (_how, options, selected) => {
        const out: string = renderTestPage(compilePage(`const Page = ({ choice }) => <select value={choice}>${options}</select>;`), { choice: 'b' });

        expect(out).toContain(selected);
        expect(out).not.toContain('<select value');
        expect(out.match(/selected/g)).toHaveLength(1);
    });

    it('renders a state handed to a select as its value', () => {
        const out: string = renderTestPage(compilePage('const Page = () => { const choice = useState(\'b\'); '
            + 'return <select value={choice}><option value="a">A</option><option value="b">B</option></select>; };'));

        expect(out).toContain('<option value="b" selected>B</option>');
    });
});

/**
 * Renders in production, recording what is logged.
 * @param page - The page.
 * @returns The document, and what was logged.
 */
function renderInProduction(page: CompiledPage): { document: string, logged: string[] } {
    const logged: string[] = [];
    const error: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation((message: unknown) => {
        logged.push(String(message));
    });
    try {
        return { document: renderPage(page, {}, { environment: 'production' }), logged };
    }
    finally {
        error.mockRestore();
    }
}

// what only the render can see: a ref handed to a component of another file is put on an element there, or
// not. A test renders in development, where these throw; production logs them and renders the page
describe('the mistakes of a ref the render shows', () => {
    // the component it is handed to renders no element with it
    const unused: string = 'const Field = ({ inputRef }) => <p>no input</p>;';
    const twice: string = 'const Field = ({ inputRef }) => <div><input ref={inputRef}/><input ref={inputRef}/></div>;';
    const required: string = 'const Page = () => { const input = useRef<HTMLInputElement>(); return <Field inputRef={input}/>; };';

    it('throws for a required ref on no element, naming the ref and the component', () => {
        expect(() => renderTestPage(compilePage(required, { Field: unused }))).toThrow(/'input' of 'Page' is on no element/);
    });

    it('renders a required ref on no element in production, and logs it', () => {
        const { document, logged } = renderInProduction(compilePage(required, { Field: unused }));

        expect(document).toContain('<p>no input</p>');
        expect(logged).toEqual([expect.stringMatching(/'input' of 'Page' is on no element/)]);
    });

    // what 3.0 called it with, which 3.x keeps compiling
    it('renders as in production when it is not told the environment, and logs a mistake', () => {
        const logged: string[] = [];
        const error: jest.SpiedFunction<typeof console.error> = jest.spyOn(console, 'error').mockImplementation((message: unknown) => {
            logged.push(String(message));
        });
        try {
            // eslint-disable-next-line typescript/no-deprecated
            expect(renderPage(compilePage(required, { Field: unused }))).toContain('<p>no input</p>');
            expect(logged).toEqual([expect.stringMatching(/'input' of 'Page' is on no element/)]);
        }
        finally {
            error.mockRestore();
        }
    });

    it('renders a ref that is not required on no element', () => {
        const page: string = 'const Page = () => { const input = useRef<HTMLInputElement>({ required: false }); return <Field inputRef={input}/>; };';

        expect(renderTestPage(compilePage(page, { Field: unused }))).toContain('<p>no input</p>');
    });

    it('throws for a useRef on two elements, pointing at useRefs', () => {
        expect(() => renderTestPage(compilePage(required, { Field: twice }))).toThrow(/'input' of 'Page' is on 2 elements[\S\s]*useRefs/);
    });

    it('renders a useRef on two elements in production, and logs it', () => {
        const { document, logged } = renderInProduction(compilePage(required, { Field: twice }));

        expect(document.match(/data-ssr="r\d+"/g)).toHaveLength(2);
        expect(logged).toEqual([expect.stringMatching(/is on 2 elements/)]);
    });

    it('throws for current read while the server renders', () => {
        const page: string = 'const Page = () => { const input = useRef<HTMLInputElement>(); const value = input.current; return <input ref={input} value={String(value)}/>; };';

        expect(() => renderTestPage(compilePage(page))).toThrow(/'input' of 'Page' was read while the server renders/);
    });

    it('stamps the element with the id of the ref, and writes nothing else of it', () => {
        const out: string = renderTestPage(compilePage('const Page = () => { const dialog = useRef<HTMLDialogElement>(); return <dialog ref={dialog}>hi</dialog>; };'));

        expect(out).toMatch(/^<!DOCTYPE html>\n<dialog data-ssr="r\d+">hi<\/dialog>$/);
    });
});
// a value following a state crosses into a component of another file, which may use it where it cannot follow
describe('the mistakes of a state handed to a component the render shows', () => {
    const badge: string = 'const Badge = ({ count }) => <p>{count > 1 ? \'many\' : \'one\'}</p>;';
    const counted: string = 'const Page = () => { const total = useState(2); return <Badge count={total.value}/>; };';
    const field: string = 'const Field = ({ value }) => { const text = useWritableInput(value); '
        + 'return <input value={text.value} onInput={ev => { text.value = ev.currentTarget.value; }}/>; };';
    const handedValue: string = 'const Page = () => { const email = useState(\'ada\'); return <Field value={email.value}/>; };';

    it('throws for a value following a state handed to a prop the component cannot follow, naming both', () => {
        expect(() => renderTestPage(compilePage(counted, { Badge: badge }))).toThrow(/'count' of 'Badge'[\S\s]*useInput/);
    });

    it('renders that prop with the value the state has in production, and logs it', () => {
        const { document, logged } = renderInProduction(compilePage(counted, { Badge: badge }));

        expect(document).toContain('<p>many</p>');
        expect(logged).toEqual([expect.stringMatching(/'count' of 'Badge'/)]);
    });

    it('takes a value following a state in a prop the component forwards to an element', () => {
        const button: string = 'const Button = ({ disabled }) => <button disabled={disabled}>send</button>;';
        const page: string = 'const Page = () => { const email = useState(\'\'); return <Button disabled={email.value === \'\'}/>; };';

        expect(renderTestPage(compilePage(page, { Button: button }))).toMatch(/<button disabled data-ssr="b0_\d+">send<\/button>/);
    });

    it('throws for a value that is not a state handed to useWritableInput, pointing at the state itself', () => {
        expect(() => renderTestPage(compilePage(handedValue, { Field: field }))).toThrow(/'text' of 'Field'[\S\s]*the state itself/);
    });

    it('renders useWritableInput handed a value in production, and logs it', () => {
        const { document, logged } = renderInProduction(compilePage(handedValue, { Field: field }));

        expect(document).toContain('value="ada"');
        expect(logged).toEqual([expect.stringMatching(/'text' of 'Field'/)]);
    });

    it('throws for a context holding a value following a state, read without useInput', () => {
        const source: string = 'import { createContext, provideContext, useContext, useState } from \'zibri\';\n'
            + 'const Counted = createContext(0);\n'
            + 'const Total = () => { const total = useContext(Counted); return <p>{total}</p>; };\n'
            + 'export const Page = () => { const count = useState(1); provideContext(Counted, count.value * 10); return <Total/>; };';

        expect(() => renderTemplateDocument(source, { zibri: { createContext } })).toThrow(/'Total'[\S\s]*useInput\(useContext/);
    });
});