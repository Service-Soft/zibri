import assert from 'node:assert';

import { describe, expect, it } from '@jest/globals';

import { ClientScript, compileClientScript } from './client-codegen';
import { collectHandlerSites } from './handlers';
import { parseTemplateOk } from '../../__testing__/parse.helper';
import { renderComponentResult, renderWithComponents } from '../../__testing__/server-render.helper';
import { collectClientGlobalAliasesFromSource } from '../../semantics/client-packages';
import { ComponentFunction, ComponentInfo, findComponents } from '../../semantics/component';
import { eraseTypes } from '../erase-types';

function componentOf(source: string): ComponentFunction {
    return infoOf(source).fn;
}

function infoOf(source: string): ComponentInfo {
    return findComponents(parseTemplateOk(source))[0];
}

function clientOf(source: string): ClientScript {
    const info: ComponentInfo = infoOf(source);
    const client: ClientScript = compileClientScript(info.fn, info.name, collectClientGlobalAliasesFromSource(source));
    return { ...client, code: client.code === undefined ? undefined : eraseTypes(client.code) };
}

// --- minimal DOM stub -------------------------------------------------------

class FakeElement {
    private readonly listeners: Record<string, ((arg: unknown) => void)[]> = {};

    constructor(private readonly stamp: string) {}

    getAttribute(name: string): string | null {
        // eslint-disable-next-line unicorn/no-null
        return name === 'data-ssr-handlers' ? this.stamp : null;
    }

    addEventListener(event: string, fn: (arg: unknown) => void): void {
        (this.listeners[event] ??= []).push(fn);
    }

    fire(event: string, arg?: unknown): void {
        for (const fn of this.listeners[event] ?? []) {
            fn(arg);
        }
    }
}

function elementsFrom(html: string): FakeElement[] {
    return [...html.matchAll(/data-ssr-handlers="([^"]+)"/g)].map(m => new FakeElement(m[1]));
}

function runClient(
    script: ClientScript,
    props: Record<string, unknown>,
    elements: FakeElement[],
    registry: unknown[],
    globals: Record<string, unknown>
): void {
    assert(script.code && script.setupName);
    // eslint-disable-next-line typescript/typedef
    const fakeDocument = { querySelectorAll: (): FakeElement[] => elements };
    const names: string[] = Object.keys(globals);
    // eslint-disable-next-line typescript/no-implied-eval
    const run: (...args: unknown[]) => void = new Function(
        'document',
        'window',
        'console',
        '__props',
        '__runtime',
        ...names,
        `${script.code}\n${script.setupName}(__props, __runtime);`
    ) as (...args: unknown[]) => void;
    run(fakeDocument, {}, console, props, { handlers: registry }, ...names.map(n => globals[n]));
}

describe('handler collection', () => {
    it('collects inline host-element handlers with events', () => {
        const { sites } = collectHandlerSites(componentOf('const A = () => <button onClick={() => go()}>x</button>;'));
        expect(sites).toHaveLength(1);
        expect(sites[0]).toMatchObject({ id: 'h0', event: 'click' });
        expect(sites[0].captureVars).toEqual([]);
    });

    it('captures enclosing map variables referenced by a handler', () => {
        const { sites } = collectHandlerSites(componentOf(
            'const A = ({ items }) => <ul>{items.map(item => <li onClick={() => pick(item)}>{item}</li>)}</ul>;'
        ));
        expect(sites).toHaveLength(1);
        expect(sites[0].captureVars).toEqual(['item']);
    });

    it('treats a local handler passed to a component as a new site', () => {
        const { sites } = collectHandlerSites(componentOf(
            'const A = () => { function inc() {} return <Button onClick={inc}>x</Button>; };'
        ));
        expect(sites).toHaveLength(1);
    });

    it('does not create a site for a handler that forwards a prop', () => {
        const { sites } = collectHandlerSites(componentOf('const A = ({ onClick }) => <button onClick={onClick}>x</button>;'));
        expect(sites).toHaveLength(0);
    });
});

describe('compileClientScript', () => {
    it('returns undefined when there is no client behavior', () => {
        expect(clientOf('const A = () => <div>static</div>;').code).toBeUndefined();
    });

    it('emits nothing for statement-level body code without onClient or a handler', () => {
        // A computed class name is pure server work; shipping it as a client setup would be dead code.
        const script: ClientScript = clientOf(
            'const A = ({ active }) => { const cls = active ? \'on\' : \'off\'; return <div className={cls}/>; };'
        );
        expect(script.code).toBeUndefined();
        expect(script.referencedProps).toEqual([]);
    });

    it('emits nothing for an onServer-only component', () => {
        // onServer never runs on the client, so a component with only an onServer block stays server-side.
        const script: ClientScript = clientOf(
            'const A = ({ title }) => { let t = title; onServer(() => { t = load(); }); return <p>{t}</p>; };'
        );
        expect(script.code).toBeUndefined();
    });

    it('emits a setup when a handler is present even without onClient', () => {
        const script: ClientScript = clientOf(
            'const A = () => { const label = \'go\'; return <button onClick={() => run(label)}>{label}</button>; };'
        );
        expect(script.code).toContain('function A$$setup');
        // The body still ships, so the handler factory can close over its locals.
        expect(script.code).toContain('const label =');
    });

    it('emits a named setup function that inlines onClient and includes the body', () => {
        const script: ClientScript = clientOf('const A = () => { onClient(() => { setup(); }); return <div/>; };');
        expect(script.setupName).toMatch(/^A\$\$setup\$[\da-f]{12}$/);
        expect(script.code).toContain(`function ${script.setupName}(__unusedProps, __ssr)`);
        expect(script.code).toContain('const onClient = (fn) => { fn(); };');
        expect(script.code).toContain('onClient(() =>');
        expect(script.code).not.toContain('return $ssr');
    });

    it('builds a handler table with a factory per site', () => {
        const script: ClientScript = clientOf('const A = () => <button onClick={() => go()}>x</button>;');
        expect(script.code).toContain('h0: { event: \'click\', make: () => (() => go()) }');
    });
});

describe('compileClientScript ?client bindings', () => {
    it('leaves a ?client import that is not renamed alone (the global already has that name)', () => {
        const script: ClientScript = clientOf(
            'import { Chart } from \'chart.js?client\';\n'
            + 'const A = ({ id }) => { onClient(() => { new Chart(id); }); return <canvas id={id}/>; };'
        );
        expect(script.code).toContain('new Chart(id)');
        expect(script.code).not.toContain('const Chart =');
    });

    it('binds a renamed ?client import to the global the vendor bundle provides', () => {
        const script: ClientScript = clientOf(
            'import { Chart as ChartJsChart } from \'chart.js?client\';\n'
            + 'const A = ({ id }) => { onClient(() => { new ChartJsChart(id); }); return <canvas id={id}/>; };'
        );
        expect(script.code).toContain('const ChartJsChart = Chart;');
        // The alias must be in scope for the whole setup, i.e. before the body runs.
        assert(script.code);
        expect(script.code.indexOf('const ChartJsChart = Chart;')).toBeLessThan(script.code.indexOf('new ChartJsChart(id)'));
    });

    it('binds a renamed ?client import used only inside a handler', () => {
        const script: ClientScript = clientOf(
            'import { io as socket } from \'socket.io-client?client\';\n'
            + 'const A = () => <button onClick={() => socket().emit(\'x\')}>go</button>;'
        );
        expect(script.code).toContain('const socket = io;');
    });

    it('does not bind a renamed ?client import that only appears in erased type positions', () => {
        // `ChartConfiguration` is a type, so there is no such browser global to look up.
        const script: ClientScript = clientOf(
            'import { ChartConfiguration as Config, Chart as ChartJsChart } from \'chart.js?client\';\n'
            + 'const A = ({ id, cfg }) => { onClient(() => { const c: Config = cfg; new ChartJsChart(id, c); }); '
            + 'return <canvas id={id}/>; };'
        );
        expect(script.code).toContain('const ChartJsChart = Chart;');
        expect(script.code).not.toContain('const Config =');
    });

    it('does not bind a renamed import of a normal (non ?client) package', () => {
        const script: ClientScript = clientOf(
            'import { helper as h } from \'./helpers\';\n'
            + 'const A = () => { onClient(() => { h(); }); return <div/>; };'
        );
        expect(script.code).not.toContain('const h =');
    });

    it('does not bind a renamed type-only ?client import', () => {
        const script: ClientScript = clientOf(
            'import type { Chart as ChartJsChart } from \'chart.js?client\';\n'
            + 'const A = ({ chart }) => { onClient(() => { render(chart); }); return <div/>; };'
        );
        expect(script.code).not.toContain('ChartJsChart');
    });
});

describe('end-to-end reattachment', () => {
    it('attaches a direct host handler that fires', () => {
        const source: string = 'const A = () => <button onClick={() => picked(\'root\')}>x</button>;';
        const { html, handlers } = renderComponentResult(source);
        const elements: FakeElement[] = elementsFrom(html);
        let received: string | undefined;
        runClient(clientOf(source), {}, elements, handlers, {
            picked: (v: string) => {
                received = v;
            }
        });
        elements[0].fire('click');
        expect(received).toBe('root');
    });

    it('captures per-iteration loop values for handlers inside .map', () => {
        const source: string = 'const A = ({ items }) => <ul>{items.map(item => <li onClick={() => picked(item)}>{item}</li>)}</ul>;';
        const { html, handlers } = renderComponentResult(source, { items: ['a', 'b', 'c'] });
        const elements: FakeElement[] = elementsFrom(html);
        expect(elements).toHaveLength(3);
        const seen: string[] = [];
        runClient(clientOf(source), { items: ['a', 'b', 'c'] }, elements, handlers, { picked: (v: string) => seen.push(v) });
        elements[2].fire('click');
        elements[0].fire('click');
        expect(seen).toEqual(['c', 'a']);
    });

    it('threads a handler across a component boundary and reattaches it', () => {
        const button: string = 'const Button = ({ onClick, children }) => <button onClick={onClick}>{children}</button>;';
        const page: string = 'const Page = () => { function inc() { picked(\'x\'); } return <Button onClick={inc}>Go</Button>; };';
        const { html, handlers } = renderWithComponents(page, { Button: button });
        expect(html).toBe('<button data-ssr-handlers="h0_0:click">Go</button>');
        const elements: FakeElement[] = elementsFrom(html);
        let received: string | undefined;
        runClient(clientOf(page), {}, elements, handlers, {
            picked: (v: string) => {
                received = v;
            }
        });
        elements[0].fire('click');
        expect(received).toBe('x');
    });

    it('threads per-iteration handlers to a component inside a loop', () => {
        const tabButton: string = 'const TabButton = ({ onClick, children }) => <button onClick={onClick}>{children}</button>;';
        const page: string = 'const Page = ({ tabs }) => { function changeTab(id) { picked(id); } '
            + 'return <div>{tabs.map(tab => <TabButton onClick={() => changeTab(tab.id)}>{tab.label}</TabButton>)}</div>; };';
        const tabs: { id: string, label: string }[] = [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }];
        const { html, handlers } = renderWithComponents(page, { TabButton: tabButton }, { tabs });
        const elements: FakeElement[] = elementsFrom(html);
        expect(elements).toHaveLength(2);
        const seen: string[] = [];
        runClient(clientOf(page), { tabs }, elements, handlers, { picked: (v: string) => seen.push(v) });
        elements[1].fire('click');
        elements[0].fire('click');
        expect(seen).toEqual(['b', 'a']);
    });
});