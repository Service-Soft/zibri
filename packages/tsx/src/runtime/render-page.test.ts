import assert from 'node:assert';

import { describe, expect, it } from 'vitest';

import { CompiledPage, LocaleData, renderPage, wrapDocument } from './render-page.ts';
import { compilePage } from '../__testing__/server-render.helper.ts';

// --- minimal DOM stub -------------------------------------------------------

class FakeElement {
    private readonly listeners: Record<string, (() => void)[]> = {};

    constructor(private readonly stamp: string) {}

    getAttribute(name: string): string | null {
        // eslint-disable-next-line unicorn/no-null
        return name === 'data-ssr-handlers' ? this.stamp : null;
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
    return [...html.matchAll(/data-ssr-handlers="([^"]+)"/g)].map(m => new FakeElement(m[1]));
}

function runScript(body: string, elements: FakeElement[], globals: Record<string, unknown>): void {
    // eslint-disable-next-line typescript-js/typedef
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
        const out: string = renderPage(page);
        expect(out).toBe('<!DOCTYPE html>\n<html><body><h1>Hi</h1></body></html>');
    });

    it('serializes only the props the client references', () => {
        const source: string = 'const Home = ({ shown, secret }) => { '
            + 'onClient(() => { track(shown); }); return <div>{secret}</div>; };';
        const out: string = renderPage(compilePage(source), { shown: 'yes', secret: 'do-not-leak' });
        const body: string = scriptBodyOf(out);
        expect(body).toContain('"shown":"yes"');
        expect(body).not.toContain('do-not-leak');
    });

    it('keeps a prop holding a closing script tag inside the script, and hands it to the client as it was', () => {
        const hostile: string = '</SCRIPT><img src=x onerror=alert(1)></script ><!--<script>';
        const source: string = 'const Home = ({ name }) => { onClient(() => { track(name); }); return <div/>; };';
        const out: string = renderPage(compilePage(source), { name: hostile });

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
        const out: string = renderPage(compilePage(source), {}, { localeData });
        expect(out.match(/<\/script/gi)).toHaveLength(1);
    });

    it('inlines the $ts hook with the render-time locale data', () => {
        const source: string = 'const Home = () => { onClient(() => { show($ts`hello`); }); return <div/>; };';
        const localeData: LocaleData = {
            locale: 'de',
            translations: { de: { hello: 'hallo' } },
            formatOptions: {}
        };
        const body: string = scriptBodyOf(renderPage(compilePage(source), {}, { localeData }));
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
        const body: string = scriptBodyOf(renderPage(compilePage(source), {}, { localeData }));

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
        const body: string = scriptBodyOf(renderPage(compilePage(source), { params: { name: 'Tim' } }, { localeData }));

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
        const body: string = scriptBodyOf(renderPage(compilePage(page, { Child: child }), {}, { localeData }));

        expect(body).toContain('"vom kind"');
        expect(body).toContain('"von der Seite"');
        expect(body).not.toContain('anderes');
    });

    it('defines a nested component setup once and calls it per instance with its own props', () => {
        const chart: string = 'const Chart = ({ canvasId }) => { onClient(() => { init(canvasId); }); '
            + 'return <canvas id={canvasId}></canvas>; };';
        const page: string = 'const Page = () => <html><body><Chart canvasId="a"/><Chart canvasId="b"/></body></html>;';
        const out: string = renderPage(compilePage(page, { Chart: chart }));
        const body: string = scriptBodyOf(out);

        expect(body.match(/function Chart\$\$setup/g)).toHaveLength(1);
        expect(body).toMatch(/Chart\$\$setup\$[\da-f]{12}\({"canvasId":"a"}, {"handlers":\[],"props":\[]}\);/);
        expect(body).toMatch(/Chart\$\$setup\$[\da-f]{12}\({"canvasId":"b"}, {"handlers":\[],"props":\[]}\);/);

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
            scriptBodyOf(renderPage(compilePage(page, { Counter: counter }))),
            [],
            { report: (id: string, n: number) => seen.push([id, n]) }
        );
        expect(seen).toEqual([['x', 1], ['y', 9]]);
    });

    it('emits vendor script tags into the head for ?client packages of rendered components', () => {
        const chart: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Chart_ = ({ id }) => { onClient(() => { new Chart(id); }); return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = () => <html><head><title>t</title></head><body><Chart_ id="a"/></body></html>;';
        const out: string = renderPage(compilePage(page, { Chart_: chart }));

        expect(out).toContain('<script src="/assets/vendor/chart-js.js"></script>');
        // The vendor tag must be in the head, i.e. before the client script near </body>.
        expect(out.indexOf('chart-js.js')).toBeLessThan(out.indexOf('Chart_$$setup'));
    });

    it('honours a custom vendor url prefix and emits each package once', () => {
        const chart: string = 'import { Chart } from \'chart.js?client\';\n'
            + 'export const Chart_ = ({ id }) => { onClient(() => { new Chart(id); }); return <canvas id={id}></canvas>; };';
        const page: string = 'const Page = () => <html><head></head><body><Chart_ id="a"/><Chart_ id="b"/></body></html>;';
        const out: string = renderPage(compilePage(page, { Chart_: chart }), {}, { vendorUrlPrefix: '/static/v' });

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

        runScript(scriptBodyOf(renderPage(compilePage(page, { Chart_: chart }))), [], { Chart: FakeChart });
        expect(built).toEqual(['a']);
    });

    it('emits no vendor tags when no component needs a client package', () => {
        const out: string = renderPage(compilePage('const Page = () => <html><head></head><body>hi</body></html>;'));
        expect(out).not.toContain('/assets/vendor/');
    });

    it('emits the handler registry and wires interactivity end to end', () => {
        const button: string = 'const Button = ({ onClick, children }) => <button onClick={onClick}>{children}</button>;';
        const page: string = 'const Home = ({ label }) => { function pick() { chose(label); } '
            + 'return <html><body><Button onClick={pick}>Go</Button></body></html>; };';
        const out: string = renderPage(compilePage(page, { Button: button }), { label: 'ok' }, { nonce: 'n1' });

        expect(out).toContain('<script nonce="n1">');
        expect(out).toContain('data-ssr-handlers="h0_0:click"');

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

    it('attaches a handler once per element when a component is rendered several times', () => {
        // Every instance runs the same setup, and each run sees the whole document — so an instance
        // must only wire up the elements that belong to it.
        const button: string = 'const Button = ({ id }) => <button onClick={() => picked(id)}>x</button>;';
        const page: string = 'const Page = () => <div><Button id="a"/><Button id="b"/></div>;';
        const out: string = renderPage(compilePage(page, { Button: button }));
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
        const body: string = scriptBodyOf(renderPage(compilePage(page, { Chart: chart }), { factor: 3 }));

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
        const body: string = scriptBodyOf(renderPage(compilePage(page, { Chart: chart, Row: row })));

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
        const body: string = scriptBodyOf(renderPage(compilePage(page, { Chart: chart }), { unit: ' KB' }));

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
        const body: string = scriptBodyOf(renderPage(compilePage(page, { Chart: chart }), { rows }));

        runScript(body, [], {
            register: (id: string, update: () => string) => {
                registered[id] = update;
            }
        });
        expect(registered['x']()).toBe('x');
        expect(registered['y']()).toBe('y');
    });

    it('keeps components apart whose handler site ids collide', () => {
        // Site ids are allocated per component, so two components both start at `h0`.
        const button: string = 'const Button = () => <button onClick={() => picked(\'button\')}>x</button>;';
        const toggle: string = 'const Toggle = () => <input onChange={() => picked(\'toggle\')}/>;';
        const page: string = 'const Page = () => <div><Button/><Toggle/></div>;';
        const out: string = renderPage(compilePage(page, { Button: button, Toggle: toggle }));
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
        const out: string = renderPage(compilePage(page, { BillingCard: billingCard, ProfileCard: profileCard }));
        const picked: string[] = [];
        const elements: FakeElement[] = elementsFrom(out);

        runScript(scriptBodyOf(out), elements, { picked: (v: string) => picked.push(v) });
        elements[0].fire('click');
        elements[1].fire('click');
        expect(picked).toEqual(['billing', 'profile']);
    });
});