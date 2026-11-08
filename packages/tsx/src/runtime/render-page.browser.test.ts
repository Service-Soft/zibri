import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Browser, chromium } from 'playwright';

import assert from 'node:assert';

import { openPage, OpenedPage } from '../__testing__/browser.helper';
import { compilePage, loadTemplatePage } from '../__testing__/server-render.helper';
import { CompiledPage } from './render-page';
import { attr, createContext, renderChild } from './server-runtime';

declare global {
    // eslint-disable-next-line typescript/consistent-type-definitions
    interface Window {
        // the writers of a page that uses state, which a test calls with the cases the server renders
        __zibriAttribute: (element: HTMLElement, name: string, value: unknown) => void,
        __zibriText: (value: unknown) => string,
        runs?: number,
        // how often an element with the id a test watches was put into the page
        added?: number
    }
}

const TIMEOUT: number = 30000;

describe('a rendered page, in a browser', () => {
    let browser: Browser;

    beforeAll(async () => {
        browser = await chromium.launch();
    }, TIMEOUT);

    afterAll(async () => {
        await browser.close();
    }, TIMEOUT);

    it('runs a handler that a nested component wraps, under the policy zibri sends', async () => {
        const button: string = 'const Button = ({ onClick }) => <button id="button" onClick={() => onClick?.(\'wrapped\')}>x</button>;';
        const page: string = 'const Page = () => <div><Button onClick={(v) => { document.getElementById(\'out\').textContent = v; }}/><p id="out"></p></div>;';
        const opened: OpenedPage = await openPage(browser, compilePage(page, { Button: button }));

        await opened.page.locator('#button').click();

        expect(await opened.page.locator('#out').textContent()).toBe('wrapped');
        expect(opened.errors).toEqual([]);
    }, TIMEOUT);

    it('reports what the page throws', async () => {
        const page: string = 'const Page = () => { onClient(() => { throw new Error(\'broken\'); }); return <div/>; };';
        const opened: OpenedPage = await openPage(browser, compilePage(page));

        expect(opened.errors).toEqual(['Error: broken']);
    }, TIMEOUT);

    // what onClient and the setups of a page do while it starts. Each component writes what happened into
    // the element with the id log, so the order is read from the page
    describe('while it starts', () => {
        const LOG: string = 'function log(entry) { document.getElementById(\'log\').textContent += entry + \';\'; }';
        // a statement of the setup that throws in the browser and not while the server renders
        const PARSED_IN_BROWSER: string = 'const parsed = typeof window === \'undefined\' ? {} : JSON.parse(\'{\');';

        async function readLog(opened: OpenedPage): Promise<string> {
            return await opened.page.locator('#log').textContent() ?? '';
        }

        it('runs onClient after the rest of the setup, so a const declared below it is read', async () => {
            const page: string = `const Page = () => { ${LOG} onClient(() => log(later)); const later = 'later'; return <p id="log"></p>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            expect(await readLog(opened)).toBe('later;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('runs onClient once the handlers of its own component are attached', async () => {
            const page: string = `const Page = () => { ${LOG} onClient(() => document.getElementById('button').click());
                return <div><button id="button" onClick={() => log('clicked')}>x</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            expect(await readLog(opened)).toBe('clicked;');
        }, TIMEOUT);

        it('runs every onClient after a throw in one of them, and reports the throw', async () => {
            const page: string = `const Page = () => { ${LOG} onClient(() => { throw new Error('first'); }); onClient(() => log('second'));
                return <p id="log"></p>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            expect(await readLog(opened)).toBe('second;');
            expect(opened.errors).toEqual(['Error: first']);
        }, TIMEOUT);

        it('runs the other components after a throw in a setup, and drops the onClient of the one that threw', async () => {
            const broken: string = `const Broken = () => { ${PARSED_IN_BROWSER} onClient(() => document.getElementById('log').textContent += 'broken;');
                return <button onClick={() => console.log(parsed)}>b</button>; };`;
            const working: string = 'const Working = () => { onClient(() => document.getElementById(\'log\').textContent += \'working;\'); '
                + 'return <button id="working" onClick={() => { document.getElementById(\'log\').textContent += \'clicked;\'; }}>w</button>; };';
            const page: string = 'const Page = () => <div><Broken/><Working/><p id="log"></p></div>;';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Broken: broken, Working: working }));

            await opened.page.locator('#working').click();

            expect(await readLog(opened)).toBe('working;clicked;');
            expect(opened.errors).toEqual([expect.stringMatching(/^SyntaxError: /)]);
        }, TIMEOUT);

        it('runs a child whose parent failed, without the functions the parent would have handed it', async () => {
            const child: string = 'const Child = ({ onPick }) => { onClient(() => document.getElementById(\'log\').textContent += typeof onPick + \';\'); '
                + 'return <button id="child" onClick={() => onPick?.()}>c</button>; };';
            const page: string = `const Page = () => { ${PARSED_IN_BROWSER} return <div><Child onPick={() => console.log(parsed)}/><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Child: child }));

            await opened.page.locator('#child').click();

            expect(await readLog(opened)).toBe('undefined;');
            expect(opened.errors).toEqual([expect.stringMatching(/^SyntaxError: /)]);
        }, TIMEOUT);

        it('runs onClient parent first, once every setup has run', async () => {
            const child: string = 'const Child = () => { onClient(() => document.getElementById(\'log\').textContent += \'child;\'); '
                + 'return <button id="child" onClick={() => { document.getElementById(\'log\').textContent += \'child clicked;\'; }}>c</button>; };';
            const page: string = `const Page = () => { ${LOG} onClient(() => { log('parent'); document.getElementById('child').click(); });
                return <div><Child/><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Child: child }));

            expect(await readLog(opened)).toBe('parent;child clicked;child;');
        }, TIMEOUT);

        it('runs onClient called from a handler right away', async () => {
            const page: string = `const Page = () => { ${LOG}
                return <div><button id="button" onClick={() => { onClient(() => log('called')); log('after'); }}>x</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();

            expect(await readLog(opened)).toBe('called;after;');
        }, TIMEOUT);

        it('runs onClient called from onClient after the ones already waiting', async () => {
            const page: string = `const Page = () => { ${LOG} onClient(() => { onClient(() => log('nested')); log('outer'); }); onClient(() => log('second'));
                return <p id="log"></p>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            expect(await readLog(opened)).toBe('outer;second;nested;');
        }, TIMEOUT);

        it('runs the onClient before an early return, and not the one after it', async () => {
            const page: string = `const Page = ({ empty }) => { ${LOG} onClient(() => log('before'));
                if (empty) { return <p id="log"></p>; }
                onClient(() => log('after'));
                return <div><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page), { empty: true });

            expect(await readLog(opened)).toBe('before;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);
    });

    // a string starting a comment and a script leaves the html parser waiting for a second end tag, so the
    // script would run to the end of the document and fail as a whole
    it('runs its script whatever a string written into it holds', async () => {
        const page: string = 'const Page = ({ note }) => <div><button id="button" onClick={() => { document.getElementById(\'out\').textContent = note; }}>x</button><p id="out"></p></div>;';
        const opened: OpenedPage = await openPage(browser, compilePage(page), { note: '<!--<script>' });

        await opened.page.locator('#button').click();

        expect(await opened.page.locator('#out').textContent()).toBe('<!--<script>');
        expect(opened.errors).toEqual([]);
    }, TIMEOUT);

    it('hands client code a date, a set and a map as what they are', async () => {
        const page: string = 'const Page = ({ when, tags, counts }) => { onClient(() => { '
            + 'document.getElementById(\'out\').textContent = [when.getTime(), tags.has(\'a\'), counts.get(\'b\')].join(\';\'); }); '
            + 'return <p id="out"></p>; };';
        const opened: OpenedPage = await openPage(browser, compilePage(page), {
            when: new Date(1000),
            tags: new Set(['a']),
            counts: new Map([['b', 2]])
        });

        expect(await opened.page.locator('#out').textContent()).toBe('1000;true;2');
        expect(opened.errors).toEqual([]);
    }, TIMEOUT);

    describe('state', () => {
        it('hands client code the initial value the server computed, and keeps what client code writes', async () => {
            const page: string = 'const Page = ({ start }) => { const count = useState(start * 10); '
                + 'return <div><button id="button" onClick={() => { count.value = count.value + 1; document.getElementById(\'out\').textContent = String(count.value); }}>+</button>'
                + '<p id="out"></p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page), { start: 4 });

            await opened.page.locator('#button').click();
            await opened.page.locator('#button').click();

            expect(await opened.page.locator('#out').textContent()).toBe('42');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        // a page counting how often its bindings ran, in a global a test reads
        const COUNTED: string = 'function label(count) { if (typeof window !== \'undefined\') { window.runs = (window.runs ?? 0) + 1; } return String(count.value); }';

        async function textOf(opened: OpenedPage, id: string): Promise<string> {
            return await opened.page.locator(`#${id}`).textContent() ?? '';
        }

        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        it('writes the text that reads a state again when it changes, beside the text around it', async () => {
            const page: string = 'const Page = () => { const count = useState(0); '
                + 'return <div><button id="button" onClick={() => { count.value = count.value + 1; }}>+</button><p id="out">Count: {count.value} times</p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await textOf(opened, 'out')).toBe('Count: 1 times');
            expect(await opened.page.locator('#out > *').count()).toBe(0);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('writes an attribute that reads a state through a function of the component', async () => {
            const page: string = 'const Page = () => { const saved = useState(\'a\'); const chosen = useState(\'a\'); '
                + 'function isDirty() { return saved.value !== chosen.value; } '
                + 'return <div><button id="choose" onClick={() => { chosen.value = \'b\'; }}>b</button>'
                + '<button id="save" disabled={!isDirty()} title={chosen.value}>save</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            expect(await opened.page.locator('#save').isDisabled()).toBe(true);

            await opened.page.locator('#choose').click();
            await settled(opened);

            expect(await opened.page.locator('#save').isDisabled()).toBe(false);
            expect(await opened.page.locator('#save').getAttribute('title')).toBe('b');
        }, TIMEOUT);

        it('runs the bindings once for several writes, and not for a write of the same value', async () => {
            const page: string = `const Page = () => { const count = useState(0); ${COUNTED}
                return <div><button id="twice" onClick={() => { count.value = 1; count.value = 2; }}>2</button>
                <button id="same" onClick={() => { count.value = 2; }}>=</button><p id="out">{label(count)}</p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            const runs: () => Promise<number> = async () => await opened.page.evaluate(() => window.runs ?? 0);
            const atStart: number = await runs();

            await opened.page.locator('#twice').click();
            await settled(opened);
            const afterTwoWrites: number = await runs();
            await opened.page.locator('#same').click();
            await settled(opened);

            expect(afterTwoWrites - atStart).toBe(1);
            expect(await runs()).toBe(afterTwoWrites);
            expect(await textOf(opened, 'out')).toBe('2');
        }, TIMEOUT);

        it('reports a binding that throws, and writes the others', async () => {
            const page: string = 'const Page = () => { const count = useState(0); '
                + 'function broken() { if (count.value > 0) { throw new Error(\'broken binding\'); } return \'fine\'; } '
                + 'return <div><button id="button" onClick={() => { count.value = 1; }}>+</button><p>{broken()}</p><p id="out">{count.value}</p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await textOf(opened, 'out')).toBe('1');
            expect(opened.errors).toEqual(['Error: broken binding']);
        }, TIMEOUT);

        it('writes a binding in a loop with the item of its row', async () => {
            const page: string = 'const Page = ({ items }) => { const chosen = useState(items[0]); '
                + 'return <ul>{items.map(item => <li id={item} className={chosen.value === item ? \'on\' : \'off\'} onClick={() => { chosen.value = item; }}>{item}</li>)}</ul>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page), { items: ['a', 'b', 'c'] });

            await opened.page.locator('#c').click();
            await settled(opened);

            expect(await opened.page.locator('#a').getAttribute('class')).toBe('off');
            expect(await opened.page.locator('#c').getAttribute('class')).toBe('on');
        }, TIMEOUT);

        it('writes the whole text of the title', async () => {
            const page: string = 'const Page = () => { const count = useState(0); '
                + 'return <html><head><title>{count.value} new</title></head><body><button id="button" onClick={() => { count.value = 3; }}>+</button></body></html>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await opened.page.title()).toBe('3 new');
        }, TIMEOUT);

        it('sets checked as the property, which a user changes', async () => {
            const page: string = 'const Page = () => { const on = useState(false); '
                + 'return <div><input id="box" type="checkbox" checked={on.value}/><button id="button" onClick={() => { on.value = !on.value; }}>toggle</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#box').click();
            await opened.page.locator('#button').click();
            await settled(opened);
            expect(await opened.page.locator('#box').isChecked()).toBe(true);
            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await opened.page.locator('#box').isChecked()).toBe(false);
        }, TIMEOUT);

        it('writes a style through the style of the element, which the policy allows', async () => {
            const page: string = 'const Page = () => { const color = useState(\'\'); '
                + 'return <div><p id="out" style={color.value === \'\' ? undefined : { color: color.value }}>x</p><button id="button" onClick={() => { color.value = \'rgb(255, 0, 0)\'; }}>red</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await opened.page.locator('#out').evaluate(element => getComputedStyle(element).color)).toBe('rgb(255, 0, 0)');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        // what the server renders and what the page writes for the same value, held together case by case
        describe('the rules the server and the page share', () => {
            const PAGE_WITH_STATE: string = 'const Page = () => { const count = useState(0); return <p>{count.value}</p>; };';

            function unescape(html: string): string {
                return html.replaceAll('&lt;', '<').replaceAll('&gt;', '>')
                    .replaceAll('&quot;', '"')
                    .replaceAll('&amp;', '&');
            }

            /**
             * What the server writes as an attribute, as the page reads it: its value, or null when it writes none.
             * @param name - The attribute's name.
             * @param value - Its value.
             * @returns The value.
             */
            function serverAttribute(name: string, value: unknown): string | null {
                const written: string = attr(name, value);
                if (written === '') {
                    return null;
                }
                const quoted: RegExpMatchArray | null = /="(.*)"$/.exec(written);
                return quoted === null ? '' : unescape(quoted[1]);
            }

            const attributes: [name: string, value: unknown][] = [
                ['title', 'a'], ['title', 5], ['title', 0], ['title', true], ['title', false], ['title', null], ['title', undefined],
                ['title', '<b>&"x"'], ['title', { a: 1 }], ['className', 'on'], ['htmlFor', 'field'], ['data-row', 2], ['aria-label', 'Close'],
                ['href', '/tasks'], ['href', 'javascript:alert(1)'], ['href', ' java\tscript:alert(1)'], ['src', 'vbscript:x'], ['disabled', true]
            ];

            it.each(attributes)('writes the attribute %s of %j as the server does', async (name, value) => {
                const opened: OpenedPage = await openPage(browser, compilePage(PAGE_WITH_STATE));
                const mapped: string = name === 'className' ? 'class' : name === 'htmlFor' ? 'for' : name;

                const written: string | null = await opened.page.evaluate(([attribute, as, given]) => {
                    const element: HTMLElement = document.createElement('div');
                    element.setAttribute(as, 'before');
                    window.__zibriAttribute(element, attribute, given);
                    return element.getAttribute(as);
                }, [name, mapped, value] as const);

                expect(written).toBe(serverAttribute(name, value));
            }, TIMEOUT);

            const texts: unknown[] = ['a', 5, 0, true, false, null, ['a', 1, null], '<b>&amp;', 12n.toString()];

            it.each(texts)('writes the text of %j as the server does', async value => {
                const opened: OpenedPage = await openPage(browser, compilePage(PAGE_WITH_STATE));

                const written: string = await opened.page.evaluate(given => window.__zibriText(given), value);

                expect(written).toBe(unescape(renderChild(value)));
            }, TIMEOUT);
        });

        it('gives each instance of a component a state of its own', async () => {
            const counter: string = 'const Counter = ({ id, start }) => { const count = useState(start); '
                + 'return <button id={id} onClick={() => { count.value = count.value + 1; document.getElementById(\'out\').textContent += id + count.value + \';\'; }}>+</button>; };';
            const page: string = 'const Page = () => <div><Counter id="a" start={1}/><Counter id="b" start={10}/><p id="out"></p></div>;';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Counter: counter }));

            await opened.page.locator('#a').click();
            await opened.page.locator('#b').click();
            await opened.page.locator('#a').click();

            expect(await opened.page.locator('#out').textContent()).toBe('a2;b11;a3;');
        }, TIMEOUT);
    });

    describe('state across components', () => {
        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        async function textOf(opened: OpenedPage, id: string): Promise<string> {
            return await opened.page.locator(`#${id}`).textContent() ?? '';
        }

        const COUNTER: string = 'const count = useState(1);';
        const INCREMENT: string = '<button id="increment" onClick={() => { count.value = count.value + 1; }}>+</button>';
        const LABEL: string = 'const Label = ({ id, text }) => <p id={id}>{text}</p>;';

        it('follows a value derived from a state in a component that forwards it to an attribute, with no hook', async () => {
            const button: string = 'const Button = ({ disabled }) => <button id="send" disabled={disabled}>send</button>;';
            const page: string = 'const Page = () => { const email = useState(\'\'); '
                + 'return <div><input id="email" onInput={ev => { email.value = ev.currentTarget.value; }}/><Button disabled={email.value === \'\'}/></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Button: button }));
            expect(await opened.page.locator('#send').isDisabled()).toBe(true);

            await opened.page.locator('#email').fill('ada@example.com');
            await settled(opened);

            expect(await opened.page.locator('#send').isDisabled()).toBe(false);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('follows a value derived from a state in a text the component forwards', async () => {
            const page: string = `const Page = () => { ${COUNTER} return <div>${INCREMENT}<Label id="label" text={'Count ' + count.value}/></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Label: LABEL }));

            await opened.page.locator('#increment').click();
            await settled(opened);

            expect(await textOf(opened, 'label')).toBe('Count 2');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('follows a value through useInput, and keeps a constant handed to it as it is', async () => {
            const preview: string = 'const Preview = ({ text, fixed }) => { const shown = useInput(text); const still = useInput(fixed); '
                + 'return <p id="preview" className={shown.value > 1 ? \'many\' : \'one\'}>{shown.value}/{still.value}</p>; };';
            const page: string = `const Page = () => { ${COUNTER} return <div>${INCREMENT}<Preview text={count.value} fixed="x"/></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Preview: preview }));

            await opened.page.locator('#increment').click();
            await settled(opened);

            expect(await textOf(opened, 'preview')).toBe('2/x');
            expect(await opened.page.locator('#preview').getAttribute('class')).toBe('many');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('lets a component write a state handed to it with useWritableInput', async () => {
            const field: string = 'const Field = ({ value }) => { const text = useWritableInput(value); '
                + 'return <input id="field" value={text.value} onInput={ev => { text.value = ev.currentTarget.value; }}/>; };';
            const page: string = 'const Page = () => { const email = useState(\'ada\'); '
                + 'return <div><Field value={email}/><p id="out">{email.value}</p><button id="reset" onClick={() => { email.value = \'\'; }}>x</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Field: field }));
            expect(await opened.page.locator('#field').inputValue()).toBe('ada');

            await opened.page.locator('#field').fill('grace');
            await settled(opened);
            expect(await textOf(opened, 'out')).toBe('grace');
            await opened.page.locator('#reset').click();
            await settled(opened);

            expect(await opened.page.locator('#field').inputValue()).toBe('');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands a value following a state down through a context', async () => {
            const source: string = 'import { createContext, provideContext, useContext, useInput, useState } from \'zibri\';\n'
                + 'const Counted = createContext(0);\n'
                + 'const Total = () => { const total = useInput(useContext(Counted)); return <p id="total">{total.value}</p>; };\n'
                + `export const Page = () => { ${COUNTER} provideContext(Counted, count.value * 10); return <div>${INCREMENT}<Total/></div>; };`;
            const compiled: CompiledPage | undefined = loadTemplatePage(source, { zibri: { createContext } });
            assert(compiled);
            const opened: OpenedPage = await openPage(browser, compiled);
            expect(await textOf(opened, 'total')).toBe('10');

            await opened.page.locator('#increment').click();
            await settled(opened);

            expect(await textOf(opened, 'total')).toBe('20');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('follows a value through a component that only passes it on', async () => {
            const outer: string = 'const Outer = ({ text }) => <section><Label id="label" text={text}/></section>;';
            const page: string = `const Page = () => { ${COUNTER} return <div>${INCREMENT}<Outer text={'Count ' + count.value}/></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Label: LABEL, Outer: outer }));

            await opened.page.locator('#increment').click();
            await settled(opened);

            expect(await textOf(opened, 'label')).toBe('Count 2');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands each child of a loop the value derived for it', async () => {
            const page: string = 'const Page = ({ rows }) => { const chosen = useState(1); '
                + 'return <div><button id="choose" onClick={() => { chosen.value = 2; }}>2</button>'
                + '{rows.map(row => <Label id={\'row\' + row} text={chosen.value === row ? \'on\' : \'off\'}/>)}</div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Label: LABEL }), { rows: [1, 2] });

            await opened.page.locator('#choose').click();
            await settled(opened);

            expect([await textOf(opened, 'row1'), await textOf(opened, 'row2')]).toEqual(['off', 'on']);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);
    });

    describe('markup rendered in the browser', () => {
        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        async function click(opened: OpenedPage, id: string): Promise<void> {
            await opened.page.locator(`#${id}`).click();
            await settled(opened);
        }

        async function rowTexts(opened: OpenedPage): Promise<string[]> {
            return await opened.page.locator('#list > li').allTextContents();
        }

        const TOGGLE: string = '<button id="toggle" onClick={() => { open.value = !open.value; }}>t</button>';

        it('shows the branch of a condition while it holds, and removes it when it does not', async () => {
            const page: string = `const Page = () => { const open = useState(true);
                return <div>${TOGGLE}{open.value && <p id="shown">Saved {open.value ? 'now' : 'never'}</p>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            expect(await opened.page.locator('#shown').textContent()).toBe('Saved now');

            await click(opened, 'toggle');
            expect(await opened.page.locator('#shown').count()).toBe(0);
            await click(opened, 'toggle');

            expect(await opened.page.locator('#shown').textContent()).toBe('Saved now');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        // a list of a prop reads neither a state nor a row, so it is the server's: the same html in every copy
        it('renders a list of a prop inside a branch the browser builds, the same in every copy', async () => {
            const page: string = `const Page = ({ kinds }) => { const open = useState(false); const kind = useState('xml');
                return <div>${TOGGLE}{open.value && <select id="kinds" value={kind}>{kinds.map(k => <option value={k}>{k}</option>)}</select>}
                <p id="kind">{kind.value}</p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page), { kinds: ['json', 'xml'] });

            await click(opened, 'toggle');
            expect(await opened.page.locator('#kinds > option').allTextContents()).toEqual(['json', 'xml']);
            expect(await opened.page.locator('#kinds').inputValue()).toBe('xml');
            await opened.page.locator('#kinds').selectOption('json');
            await settled(opened);
            expect(await opened.page.locator('#kind').textContent()).toBe('json');

            await click(opened, 'toggle');
            await click(opened, 'toggle');
            expect(await opened.page.locator('#kinds > option').allTextContents()).toEqual(['json', 'xml']);
            expect(await opened.page.locator('#kinds').inputValue()).toBe('json');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('takes over the elements the server rendered, and builds none of them again', async () => {
            const page: string = `const Page = () => { const open = useState(true); const count = useState(0);
                return <div><button id="count" onClick={() => { count.value = count.value + 1; }}>+</button>
                {open.value && <p id="shown">{count.value}</p>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page), {}, 'development', async watched => {
                await watched.addInitScript(() => {
                    window.added = 0;
                    new MutationObserver(records => {
                        for (const record of records) {
                            for (const node of record.addedNodes) {
                                if (node instanceof Element && node.id === 'shown') {
                                    window.added = (window.added ?? 0) + 1;
                                }
                            }
                        }
                    }).observe(document, { childList: true, subtree: true });
                });
            });

            await click(opened, 'count');

            expect(await opened.page.locator('#shown').textContent()).toBe('1');
            expect(await opened.page.evaluate(() => window.added)).toBe(1);
        }, TIMEOUT);

        it('renders the branch of a ternary that holds, and switches to the other', async () => {
            const page: string = `const Page = () => { const open = useState(false);
                return <div>${TOGGLE}{open.value ? <p id="error">Failed</p> : <p id="fine">All good</p>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            // the html, before the script, which describes both branches
            expect((await opened.page.content()).split('<script')[0]).not.toContain('Failed');

            await click(opened, 'toggle');

            expect(await opened.page.locator('#error').textContent()).toBe('Failed');
            expect(await opened.page.locator('#fine').count()).toBe(0);
        }, TIMEOUT);

        const TODOS: string = 'const todos = useState([{ id: \'a\', text: \'Write\', done: false }, { id: \'b\', text: \'Read\', done: true }]);';

        it('adds, removes, moves and changes the rows of a list by their key', async () => {
            const page: string = `const Page = () => { ${TODOS}
                return <div>
                    <button id="add" onClick={() => { todos.value = [...todos.value, { id: 'c', text: 'Sleep', done: false }]; }}>+</button>
                    <button id="rename" onClick={() => { todos.value = todos.value.map(t => t.id === 'a' ? { ...t, text: 'Write more' } : t); }}>r</button>
                    <button id="reverse" onClick={() => { todos.value = [...todos.value].reverse(); }}>v</button>
                    <ul id="list">{todos.value.map(todo => <li key={todo.id} id={'todo-' + todo.id}>{todo.text}
                        <button id={'remove-' + todo.id} onClick={() => { todos.value = todos.value.filter(t => t.id !== todo.id); }}>x</button></li>)}</ul>
                </div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            // an element the page keeps keeps this property, one built again does not
            await opened.page.evaluate(() => Object.assign(document.getElementById('todo-a') ?? {}, { kept: true }));

            await click(opened, 'add');
            expect(await rowTexts(opened)).toEqual(['Writex', 'Readx', 'Sleepx']);
            await click(opened, 'rename');
            expect(await rowTexts(opened)).toEqual(['Write morex', 'Readx', 'Sleepx']);
            await click(opened, 'remove-b');
            expect(await rowTexts(opened)).toEqual(['Write morex', 'Sleepx']);
            await click(opened, 'reverse');

            expect(await rowTexts(opened)).toEqual(['Sleepx', 'Write morex']);
            expect(await opened.page.evaluate(() => Reflect.get(document.getElementById('todo-a') ?? {}, 'kept'))).toBe(true);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('keeps the focus and the text of an input in a row that moves', async () => {
            const page: string = `const Page = () => { ${TODOS}
                return <ul id="list">{todos.value.map(todo => <li key={todo.id}><input id={'input-' + todo.id}
                    onKeyDown={ev => { if (ev.key === 'ArrowUp') { todos.value = [...todos.value].reverse(); } }}/></li>)}</ul>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#input-b').fill('hi');
            await opened.page.locator('#input-b').press('ArrowUp');
            await settled(opened);

            expect(await opened.page.evaluate(() => document.activeElement?.id)).toBe('input-b');
            expect(await opened.page.locator('#list > li:first-child input').inputValue()).toBe('hi');
        }, TIMEOUT);

        it('reports two rows with the same key after a change, and keeps the rows it has', async () => {
            const page: string = `const Page = () => { ${TODOS}
                return <div><button id="twice" onClick={() => { todos.value = [todos.value[0], todos.value[0]]; }}>2</button>
                <ul id="list">{todos.value.map(todo => <li key={todo.id}>{todo.text}</li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await click(opened, 'twice');

            expect(await rowTexts(opened)).toEqual(['Write', 'Read']);
            expect(opened.errors).toEqual([expect.stringMatching(/'a'/)]);
        }, TIMEOUT);

        it('follows a condition inside a row with the item of the row', async () => {
            const page: string = `const Page = () => { ${TODOS}
                return <div><button id="finish" onClick={() => { todos.value = todos.value.map(t => ({ ...t, done: true })); }}>f</button>
                <ul id="list">{todos.value.map(todo => <li key={todo.id}>{todo.text}{todo.done && <b>done</b>}</li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            expect(await rowTexts(opened)).toEqual(['Write', 'Readdone']);

            await click(opened, 'finish');

            expect(await rowTexts(opened)).toEqual(['Writedone', 'Readdone']);
        }, TIMEOUT);

        it('binds a state both ways and writes a spread in markup it renders', async () => {
            const page: string = `const Page = () => { const open = useState(false); const email = useState('ada'); const hint = { title: 'mail' };
                return <div>${TOGGLE}{open.value && <input id="field" value={email} {...hint}/>}<p id="out">{email.value}</p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await click(opened, 'toggle');
            expect(await opened.page.locator('#field').inputValue()).toBe('ada');
            expect(await opened.page.locator('#field').getAttribute('title')).toBe('mail');
            await opened.page.locator('#field').fill('grace');
            await settled(opened);

            expect(await opened.page.locator('#out').textContent()).toBe('grace');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands useRefs the elements of the rows the list has', async () => {
            const page: string = `const Page = () => { ${TODOS} const rows = useRefs<HTMLLIElement>();
                return <div><button id="add" onClick={() => { todos.value = [{ id: 'c', text: 'Sleep', done: false }, ...todos.value]; }}>+</button>
                <button id="drop" onClick={() => { todos.value = todos.value.slice(1); }}>-</button>
                <button id="count" onClick={() => { document.getElementById('out').textContent = rows.current.map(row => row.textContent).join(','); }}>c</button>
                <p id="out"></p><ul id="list">{todos.value.map(todo => <li key={todo.id} ref={rows}>{todo.text}</li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await click(opened, 'add');
            await click(opened, 'count');
            expect(await opened.page.locator('#out').textContent()).toBe('Sleep,Write,Read');
            await click(opened, 'drop');
            await click(opened, 'count');

            expect(await opened.page.locator('#out').textContent()).toBe('Write,Read');
        }, TIMEOUT);

        it('keeps the children a component places inside a condition it renders again', async () => {
            const card: string = `const Card = ({ children }) => { const open = useState(true);
                return <div>${TOGGLE}{open.value && <section id="inner">{children}<p id="state">{open.value ? 'on' : 'off'}</p></section>}</div>; };`;
            const page: string = 'const Page = () => <Card><b id="child">x</b></Card>;';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Card: card }));
            expect(opened.errors).toEqual([]);

            await click(opened, 'toggle');
            await click(opened, 'toggle');

            expect(await opened.page.locator('#child').textContent()).toBe('x');
            expect(await opened.page.locator('#state').textContent()).toBe('on');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        const READ_REF: string ='<button id="read" onClick={() => { document.getElementById(\'out\').textContent = String(shown.current?.id); }}>r</button><p id="out"></p>';

        it('hands a ref that is not required the element of a condition while it is shown, and nothing while it is not', async () => {
            const page: string = `const Page = () => { const open = useState(true); const shown = useRef<HTMLElement>({ required: false });
                return <div>${TOGGLE}${READ_REF}{open.value && <p id="saved" ref={shown}>Saved</p>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await click(opened, 'read');
            expect(await opened.page.locator('#out').textContent()).toBe('saved');
            await click(opened, 'toggle');
            await click(opened, 'read');
            expect(await opened.page.locator('#out').textContent()).toBe('undefined');
            await click(opened, 'toggle');
            await click(opened, 'read');

            expect(await opened.page.locator('#out').textContent()).toBe('saved');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands a required ref on each branch of a condition the element of the branch that is shown', async () => {
            const page: string = `const Page = () => { const open = useState(false); const shown = useRef<HTMLElement>();
                return <div>${TOGGLE}${READ_REF}{open.value ? <p id="error" ref={shown}>Failed</p> : <p id="fine" ref={shown}>All good</p>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await click(opened, 'read');
            expect(await opened.page.locator('#out').textContent()).toBe('fine');
            await click(opened, 'toggle');
            await click(opened, 'read');

            expect(await opened.page.locator('#out').textContent()).toBe('error');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);
    });

    // what a branch or a row holds that only the server can render: a component, or the children a component places
    describe('components inside markup rendered in the browser', () => {
        const LOG: string = 'function log(entry) { document.getElementById(\'log\').textContent += entry + \';\'; }';
        const TOGGLE: string = '<button id="toggle" onClick={() => { open.value = !open.value; }}>t</button>';
        const TODOS: string = 'const todos = useState([{ id: \'a\', text: \'Write\' }, { id: \'b\', text: \'Read\' }]);';
        const ADD: string = '<button id="add" onClick={() => { todos.value = [...todos.value, { id: \'c\', text: \'Sleep\' }]; }}>+</button>';
        const RENAME: string = '<button id="rename" onClick={() => { todos.value = todos.value.map(t => t.id === \'a\' ? { ...t, text: \'Write more\' } : t); }}>r</button>';
        const REVERSE: string = '<button id="reverse" onClick={() => { todos.value = [...todos.value].reverse(); }}>v</button>';
        // a component counting its clicks, which writes when it starts, changes and goes
        const COUNTER: string = `const Counter = () => { ${LOG} const n = useState(0);
            onClient(() => { log('start'); return () => log('stop'); });
            useEffect(() => { const seen = n.value; log('n' + seen); return () => log('undo' + seen); }, [n]);
            return <button id="count" onClick={() => { n.value = n.value + 1; }}>{n.value}</button>; };`;

        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        async function click(opened: OpenedPage, id: string): Promise<void> {
            await opened.page.locator(`#${id}`).click();
            await settled(opened);
        }

        async function textOf(opened: OpenedPage, id: string): Promise<string> {
            return await opened.page.locator(`#${id}`).textContent() ?? '';
        }

        async function rowTexts(opened: OpenedPage): Promise<string[]> {
            return await opened.page.locator('#list > li').allTextContents();
        }

        it('removes a component with its branch, running its cleanups, and starts it anew when the branch is shown again', async () => {
            const page: string = `const Page = () => { const open = useState(true);
                return <div>${TOGGLE}<p id="log"></p>{open.value && <Counter/>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Counter: COUNTER }));
            await click(opened, 'count');
            expect(await textOf(opened, 'count')).toBe('1');
            expect(await textOf(opened, 'log')).toBe('start;n0;undo0;n1;');

            await click(opened, 'toggle');
            expect(await opened.page.locator('#count').count()).toBe(0);
            expect(await textOf(opened, 'log')).toBe('start;n0;undo0;n1;stop;undo1;');
            await click(opened, 'toggle');
            expect(await textOf(opened, 'count')).toBe('0');
            await click(opened, 'count');

            expect(await textOf(opened, 'count')).toBe('1');
            expect(await textOf(opened, 'log')).toBe('start;n0;undo0;n1;stop;undo1;start;n0;undo0;n1;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('builds a component in a branch the server did not show', async () => {
            const page: string = `const Page = () => { const open = useState(false);
                return <div>${TOGGLE}<p id="log"></p>{open.value ? <Counter/> : <i id="none">none</i>}</div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Counter: COUNTER }));
            expect(await opened.page.locator('#count').count()).toBe(0);

            await click(opened, 'toggle');
            await click(opened, 'count');

            expect(await textOf(opened, 'count')).toBe('1');
            expect(await opened.page.locator('#none').count()).toBe(0);
            expect(await textOf(opened, 'log')).toBe('start;n0;undo0;n1;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('renders a component per row, following the item and calling a handler of the row', async () => {
            const item: string = `const Item = ({ todo, onRemove }) => { const t = useInput(todo);
                return <li id={'item-' + t.value.id}>{t.value.text}<button id={'remove-' + t.value.id} onClick={() => onRemove()}>x</button></li>; };`;
            const page: string = `const Page = () => { ${TODOS}
                return <div>${ADD}${RENAME}${REVERSE}<ul id="list">{todos.value.map(todo => <Item key={todo.id} todo={todo}
                    onRemove={() => { todos.value = todos.value.filter(t => t.id !== todo.id); }}/>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Item: item }));
            // an element the page keeps keeps this property, one built again does not
            await opened.page.evaluate(() => Object.assign(document.getElementById('item-a') ?? {}, { kept: true }));

            await click(opened, 'add');
            expect(await rowTexts(opened)).toEqual(['Writex', 'Readx', 'Sleepx']);
            await click(opened, 'rename');
            expect(await rowTexts(opened)).toEqual(['Write morex', 'Readx', 'Sleepx']);
            await click(opened, 'reverse');
            expect(await rowTexts(opened)).toEqual(['Sleepx', 'Readx', 'Write morex']);
            await click(opened, 'remove-b');
            await click(opened, 'remove-c');

            expect(await rowTexts(opened)).toEqual(['Write morex']);
            expect(await opened.page.evaluate(() => Reflect.get(document.getElementById('item-a') ?? {}, 'kept'))).toBe(true);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('forwards a value of the row a component is handed to its text and its attributes', async () => {
            const label: string = 'const Label = ({ id, text }) => <b id={id} title={text}>{text}</b>;';
            const page: string = `const Page = () => { ${TODOS}
                return <div>${ADD}${RENAME}<ul id="list">{todos.value.map(todo => <li key={todo.id}><Label id={'label-' + todo.id} text={todo.text}/></li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Label: label }));

            await click(opened, 'add');
            await click(opened, 'rename');

            expect(await rowTexts(opened)).toEqual(['Write more', 'Read', 'Sleep']);
            expect(await opened.page.locator('#label-a').getAttribute('title')).toBe('Write more');
            expect(await opened.page.locator('#label-c').getAttribute('title')).toBe('Sleep');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('keeps the state of the component in each row with its row', async () => {
            const counter: string = 'const Counter = ({ id }) => { const n = useState(0); '
                + 'return <button id={id} onClick={() => { n.value = n.value + 1; }}>{n.value}</button>; };';
            const page: string = `const Page = () => { ${TODOS}
                return <div>${ADD}${REVERSE}<ul id="list">{todos.value.map(todo => <li key={todo.id}><Counter id={'count-' + todo.id}/></li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Counter: counter }));

            await click(opened, 'count-a');
            await click(opened, 'add');
            await click(opened, 'count-c');
            await click(opened, 'count-c');
            await click(opened, 'reverse');

            expect(await rowTexts(opened)).toEqual(['2', '0', '1']);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('renders the children a component in a row places, following the row', async () => {
            const box: string = 'const Box = ({ children }) => <div class="box">{children}</div>;';
            const page: string = `const Page = () => { ${TODOS}
                return <div>${ADD}${RENAME}<ul id="list">{todos.value.map(todo => <li key={todo.id}><Box><span>{todo.text}</span></Box></li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Box: box }));

            await click(opened, 'add');
            await click(opened, 'rename');

            expect(await rowTexts(opened)).toEqual(['Write more', 'Read', 'Sleep']);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('keeps a handler of the page in the children a component shows again', async () => {
            const card: string = `const Card = ({ children }) => { const open = useState(true);
                return <div>${TOGGLE}{open.value && <section>{children}</section>}</div>; };`;
            const page: string = 'const Page = () => <div><Card><button id="hello" onClick={() => { document.getElementById(\'out\').textContent = \'hi\'; }}>h</button></Card>'
                + '<p id="out"></p></div>;';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Card: card }));

            await click(opened, 'toggle');
            await click(opened, 'toggle');
            await click(opened, 'hello');

            expect(await textOf(opened, 'out')).toBe('hi');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands useRefs the elements of the components in the rows a list has', async () => {
            const field: string = 'const Field = ({ inputRef, name }) => <input ref={inputRef} name={name}/>;';
            const page: string = `const Page = () => { ${TODOS} const fields = useRefs<HTMLInputElement>();
                return <div>${ADD}<button id="names" onClick={() => { document.getElementById('out').textContent = fields.current.map(f => f.name).join(','); }}>n</button>
                <p id="out"></p><ul id="list">{todos.value.map(todo => <li key={todo.id}><Field inputRef={fields} name={todo.id}/></li>)}</ul></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Field: field }));

            await click(opened, 'add');
            await click(opened, 'names');

            expect(await textOf(opened, 'out')).toBe('a,b,c');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);
    });

    describe('form controls', () => {
        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        async function textOf(opened: OpenedPage, id: string): Promise<string> {
            return await opened.page.locator(`#${id}`).textContent() ?? '';
        }

        it('writes what is typed into a state handed to an input, and shows a change of the state in it', async () => {
            const page: string = 'const Page = () => { const email = useState(\'ada\'); '
                + 'return <div><input id="email" value={email}/><p id="out">{email.value}</p>'
                + '<button id="reset" onClick={() => { email.value = \'\'; }}>x</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            expect(await opened.page.locator('#email').inputValue()).toBe('ada');

            await opened.page.locator('#email').fill('grace');
            await settled(opened);
            expect(await textOf(opened, 'out')).toBe('grace');
            await opened.page.locator('#reset').click();
            await settled(opened);

            expect(await opened.page.locator('#email').inputValue()).toBe('');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('checks a box from a state, and writes back when it is clicked', async () => {
            const page: string = 'const Page = () => { const agreed = useState(false); '
                + 'return <div><input id="agree" type="checkbox" checked={agreed}/><p id="out">{agreed.value ? \'yes\' : \'no\'}</p>'
                + '<button id="toggle" onClick={() => { agreed.value = !agreed.value; }}>x</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#agree').click();
            await settled(opened);
            expect(await textOf(opened, 'out')).toBe('yes');
            await opened.page.locator('#toggle').click();
            await settled(opened);

            expect(await opened.page.locator('#agree').isChecked()).toBe(false);
            expect(await textOf(opened, 'out')).toBe('no');
        }, TIMEOUT);

        it('binds a textarea and a select both ways', async () => {
            const page: string = 'const Page = () => { const note = useState(\'\'); const choice = useState(\'b\'); '
                + 'return <div><textarea id="note" value={note}/>'
                + '<select id="choice" value={choice}><option value="a">a</option><option value="b">b</option></select>'
                + '<p id="out">{note.value}/{choice.value}</p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));
            expect(await opened.page.locator('#choice').inputValue()).toBe('b');

            await opened.page.locator('#note').fill('hello');
            await opened.page.locator('#choice').selectOption('a');
            await settled(opened);

            expect(await textOf(opened, 'out')).toBe('hello/a');
        }, TIMEOUT);

        it('binds the value of a state one way', async () => {
            const page: string = 'const Page = () => { const email = useState(\'ada\'); '
                + 'return <div><input id="email" value={email.value}/><p id="out">{email.value}</p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#email').fill('grace');
            await settled(opened);

            expect(await textOf(opened, 'out')).toBe('ada');
        }, TIMEOUT);

        it('binds a state both ways through a component that forwards it to an input', async () => {
            const field: string = 'const Field = ({ value }) => <input id="field" value={value}/>;';
            const page: string = 'const Page = () => { const email = useState(\'ada\'); '
                + 'return <div><Field value={email}/><p id="out">{email.value}</p><button id="reset" onClick={() => { email.value = \'\'; }}>x</button></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Field: field }));
            expect(await opened.page.locator('#field').inputValue()).toBe('ada');

            await opened.page.locator('#field').fill('grace');
            await settled(opened);
            expect(await textOf(opened, 'out')).toBe('grace');
            await opened.page.locator('#reset').click();
            await settled(opened);

            expect(await opened.page.locator('#field').inputValue()).toBe('');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('fires onChange of a text field when it loses focus, as the DOM does', async () => {
            const page: string = 'const Page = () => { const email = useState(\'\'); '
                + 'return <div><input id="email" value={email} onChange={() => { document.getElementById(\'log\').textContent += \'change;\'; }}/>'
                + '<p id="log"></p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#email').fill('grace');
            const whileTyping: string = await textOf(opened, 'log');
            await opened.page.locator('#email').blur();

            expect(whileTyping).toBe('');
            expect(await textOf(opened, 'log')).toBe('change;');
        }, TIMEOUT);
    });

    describe('effects', () => {
        const LOG: string = 'function log(entry) { document.getElementById(\'log\').textContent += entry + \';\'; }';

        async function readLog(opened: OpenedPage): Promise<string> {
            return await opened.page.locator('#log').textContent() ?? '';
        }

        async function settled(opened: OpenedPage): Promise<void> {
            await opened.page.evaluate(async () => await new Promise(resolve => setTimeout(resolve, 0)));
        }

        it('runs an effect first in the queue of onClient, once every setup has run', async () => {
            const child: string = 'const Child = () => { onClient(() => document.getElementById(\'log\').textContent += \'child;\'); return <p/>; };';
            const page: string = `const Page = () => { ${LOG} const count = useState(0);
                onClient(() => log('before')); useEffect(() => log('effect ' + count.value), [count]); onClient(() => log('after'));
                return <div><Child/><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Child: child }));

            expect(await readLog(opened)).toBe('before;effect 0;after;child;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('runs an effect again after a change, once the bindings are written', async () => {
            const page: string = `const Page = () => { ${LOG} const count = useState(0);
                useEffect(() => log('shown ' + document.getElementById('out').textContent), [count]);
                return <div><button id="button" onClick={() => { count.value = count.value + 1; }}>+</button><p id="out">{count.value}</p><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await readLog(opened)).toBe('shown 0;shown 1;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('does not run an effect again for a change of a state it does not list', async () => {
            const page: string = `const Page = () => { ${LOG} const watched = useState(0); const other = useState(0);
                useEffect(() => log('effect'), [watched]);
                return <div><button id="other" onClick={() => { other.value = 1; }}>o</button>
                <button id="same" onClick={() => { watched.value = 0; }}>s</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#other').click();
            await opened.page.locator('#same').click();
            await settled(opened);

            expect(await readLog(opened)).toBe('effect;');
        }, TIMEOUT);

        it('runs an effect again when a function in its list returns something else', async () => {
            const page: string = `const Page = () => { ${LOG} const count = useState(0); function isBig() { return count.value > 1; }
                useEffect(() => log('big ' + isBig()), [isBig]);
                return <div><button id="button" onClick={() => { count.value = count.value + 1; }}>+</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            for (let click: number = 0; click < 3; click++) {
                await opened.page.locator('#button').click();
                await settled(opened);
            }

            expect(await readLog(opened)).toBe('big false;big true;');
        }, TIMEOUT);

        it('runs the cleanup of an effect before it runs again', async () => {
            const page: string = `const Page = () => { ${LOG} const count = useState(0);
                useEffect(() => { const seen = count.value; log('run ' + seen); return () => log('cleanup ' + seen); }, [count]);
                return <div><button id="button" onClick={() => { count.value = count.value + 1; }}>+</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await readLog(opened)).toBe('run 0;cleanup 0;run 1;');
        }, TIMEOUT);

        it('reports an effect that throws, and runs the others', async () => {
            const page: string = `const Page = () => { ${LOG} const count = useState(0);
                useEffect(() => { if (count.value > 0) { throw new Error('broken effect ' + count.value); } }, [count]);
                useEffect(() => log('working ' + count.value), [count]);
                return <div><button id="button" onClick={() => { count.value = count.value + 1; }}>+</button><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            await opened.page.locator('#button').click();
            await settled(opened);

            expect(await readLog(opened)).toBe('working 0;working 1;');
            expect(opened.errors).toEqual(['Error: broken effect 1']);
        }, TIMEOUT);
    });

    describe('refs', () => {
        const LOG: string = 'function log(entry) { document.getElementById(\'log\').textContent += entry + \';\'; }';

        async function readLog(opened: OpenedPage): Promise<string> {
            return await opened.page.locator('#log').textContent() ?? '';
        }

        it('hands client code the element a ref is put on', async () => {
            const page: string = `const Page = () => { ${LOG} const dialog = useRef<HTMLDialogElement>();
                onClient(() => { dialog.current.showModal(); log(dialog.current.open); });
                return <div><dialog ref={dialog}>hi</dialog><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page));

            expect(await readLog(opened)).toBe('true;');
            expect(await opened.page.locator('dialog').getAttribute('data-ssr')).toMatch(/^r\d+$/);
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands client code undefined for a ref that is not required and on no element', async () => {
            const page: string = `const Page = ({ shown }) => { ${LOG} const hint = useRef<HTMLElement>({ required: false });
                onClient(() => log(hint.current === undefined));
                return <div>{shown ? <em ref={hint}>hint</em> : null}<p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page), { shown: false });

            expect(await readLog(opened)).toBe('true;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('hands client code every element useRefs is put on, in document order', async () => {
            const page: string = `const Page = ({ items }) => { ${LOG} const rows = useRefs<HTMLLIElement>();
                onClient(() => log(rows.current.map(row => row.textContent).join(',')));
                return <div><ul>{items.map(item => <li ref={rows}>{item}</li>)}</ul><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page), { items: ['a', 'b', 'c'] });

            expect(await readLog(opened)).toBe('a,b,c;');
        }, TIMEOUT);

        it('follows a ref handed to a component under another name', async () => {
            const field: string = 'const Field = ({ inputRef }) => <label>Name <input ref={inputRef} value="Ada"/></label>;';
            const page: string = `const Page = () => { ${LOG} const input = useRef<HTMLInputElement>();
                onClient(() => log(input.current.value));
                return <div><Field inputRef={input}/><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Field: field }));

            expect(await readLog(opened)).toBe('Ada;');
        }, TIMEOUT);

        it('lets the component a ref is handed to read it', async () => {
            const field: string = 'const Field = ({ inputRef }) => { onClient(() => { document.getElementById(\'log\').textContent += inputRef.current.value + \';\'; }); '
                + 'return <input ref={inputRef} value="Ada"/>; };';
            const page: string = 'const Page = () => { const input = useRef<HTMLInputElement>(); return <div><Field inputRef={input}/><p id="log"></p></div>; };';
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Field: field }));

            expect(await readLog(opened)).toBe('Ada;');
            expect(opened.errors).toEqual([]);
        }, TIMEOUT);

        it('throws when client code reads a required ref on no element, which production renders', async () => {
            const field: string = 'const Field = ({ inputRef }) => <p>no input</p>;';
            const page: string = 'const Page = () => { const input = useRef<HTMLInputElement>(); onClient(() => console.log(input.current)); '
                + 'return <Field inputRef={input}/>; };';
            const original: typeof console.error = console.error;
            console.error = () => undefined;
            let opened: OpenedPage;
            try {
                opened = await openPage(browser, compilePage(page, { Field: field }), {}, 'production');
            }
            finally {
                console.error = original;
            }

            expect(opened.errors).toEqual(['Error: The ref \'input\' of \'Page\' is on no element in the page.']);
        }, TIMEOUT);

        it('follows a ref on an element handed to a component as its children', async () => {
            const card: string = 'const Card = ({ children }) => <section>{children}</section>;';
            const page: string = `const Page = () => { ${LOG} const title = useRef<HTMLHeadingElement>();
                onClient(() => log(title.current.textContent));
                return <div><Card><h2 ref={title}>Tasks</h2></Card><p id="log"></p></div>; };`;
            const opened: OpenedPage = await openPage(browser, compilePage(page, { Card: card }));

            expect(await readLog(opened)).toBe('Tasks;');
        }, TIMEOUT);
    });

    it('reports what the policy refuses', async () => {
        const opened: OpenedPage = await openPage(browser, compilePage('const Page = () => <img src="https://elsewhere.test/x.png"/>;'));

        expect(opened.errors).toEqual([expect.stringContaining('\'https://elsewhere.test/x.png\' violates the following Content Security Policy directive')]);
    }, TIMEOUT);
});
