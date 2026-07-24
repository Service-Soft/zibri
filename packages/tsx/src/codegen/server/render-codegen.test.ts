import { describe, expect, it } from '@jest/globals';

import { compileComponent, renderComponent } from '../../__testing__/server-render.helper';
import { CompiledComponent } from '../../runtime/server-runtime';

describe('server render codegen', () => {
    describe('elements, text and expressions', () => {
        it('renders a static element', () => {
            expect(renderComponent('const A = () => <div>hi</div>;')).toBe('<div>hi</div>');
        });

        it('interpolates and escapes dynamic text', () => {
            expect(renderComponent('const A = ({ t }) => <p>{t}</p>;', { t: '<b> & "x"' }))
                .toBe('<p>&lt;b&gt; &amp; "x"</p>');
        });

        it('renders numbers without escaping', () => {
            expect(renderComponent('const A = ({ n }) => <span>{n}</span>;', { n: 42 })).toBe('<span>42</span>');
        });

        it('drops null, undefined and boolean children', () => {
            // eslint-disable-next-line unicorn/no-null
            expect(renderComponent('const A = ({ x }) => <div>{x}</div>;', { x: null })).toBe('<div></div>');
            expect(renderComponent('const A = ({ x }) => <div>{x}</div>;', { x: false })).toBe('<div></div>');
        });
    });

    describe('attributes', () => {
        it('renders static attributes with className mapping', () => {
            expect(renderComponent('const A = () => <div className="box" id="x">t</div>;'))
                .toBe('<div class="box" id="x">t</div>');
        });

        it('renders dynamic attributes and escapes values', () => {
            expect(renderComponent('const A = ({ c }) => <div className={c}>t</div>;', { c: 'a"b' }))
                .toBe('<div class="a&quot;b">t</div>');
        });

        it('omits null/false attributes and renders boolean true as bare', () => {
            expect(renderComponent('const A = ({ d }) => <input disabled={d} />;', { d: false })).toBe('<input/>');
            expect(renderComponent('const A = ({ d }) => <input disabled={d} />;', { d: true })).toBe('<input disabled/>');
        });

        it('renders a boolean shorthand attribute', () => {
            expect(renderComponent('const A = () => <input disabled />;')).toBe('<input disabled/>');
        });

        it('serializes style objects', () => {
            expect(renderComponent('const A = ({ s }) => <div style={s}>t</div>;', { s: { color: 'red', fontSize: '12px' } }))
                .toBe('<div style="color:red;font-size:12px">t</div>');
        });

        it('spreads an attribute object', () => {
            expect(renderComponent('const A = ({ p }) => <div {...p}>t</div>;', { p: { id: 'x', className: 'y' } }))
                .toBe('<div id="x" class="y">t</div>');
        });

        it('stamps event handlers for reattachment instead of rendering them as attributes', () => {
            const html: string = renderComponent('const A = () => <button onClick={() => go()}>t</button>;');
            expect(html).not.toContain('onClick');
            expect(html).toBe('<button data-ssr-handlers="h0_0:click">t</button>');
        });
    });

    describe('void elements and dangerous html', () => {
        it('self-closes void elements', () => {
            expect(renderComponent('const A = () => <br />;')).toBe('<br/>');
            expect(renderComponent('const A = ({ src }) => <img src={src} />;', { src: 'a.png' })).toBe('<img src="a.png"/>');
        });

        it('renders dangerouslySetInnerHTML raw', () => {
            expect(renderComponent('const A = ({ h }) => <div dangerouslySetInnerHTML={h} />;', { h: { __html: '<b>x</b>' } }))
                .toBe('<div><b>x</b></div>');
        });
    });

    describe('control flow, fragments and loops', () => {
        it('renders fragments', () => {
            expect(renderComponent('const A = () => <><span>a</span><span>b</span></>;')).toBe('<span>a</span><span>b</span>');
        });

        it('renders ternaries and logical-and in children', () => {
            expect(renderComponent('const A = ({ ok }) => <div>{ok ? <b>y</b> : <i>n</i>}</div>;', { ok: true }))
                .toBe('<div><b>y</b></div>');
            expect(renderComponent('const A = ({ ok }) => <div>{ok && <b>y</b>}</div>;', { ok: false }))
                .toBe('<div></div>');
        });

        it('renders .map loops of elements', () => {
            expect(renderComponent('const A = ({ items }) => <ul>{items.map(i => <li>{i}</li>)}</ul>;', { items: ['a', 'b'] }))
                .toBe('<ul><li>a</li><li>b</li></ul>');
        });

        it('handles early returns of JSX in a block body', () => {
            const source: string = 'const A = ({ ok }) => { if (!ok) { return <span>empty</span>; } return <span>full</span>; };';
            expect(renderComponent(source, { ok: false })).toBe('<span>empty</span>');
            expect(renderComponent(source, { ok: true })).toBe('<span>full</span>');
        });

        it('supports rest parameters in local helpers', () => {
            const source: string = 'const A = () => { function join(...parts) { return parts.join(\'-\'); } '
                + 'return <span>{join(\'a\', \'b\')}</span>; };';
            expect(renderComponent(source)).toBe('<span>a-b</span>');
        });

        it('runs local variables and helpers in the body', () => {
            const source: string = 'const A = ({ n }) => { const doubled = n * 2; return <span>{doubled}</span>; };';
            expect(renderComponent(source, { n: 3 })).toBe('<span>6</span>');
        });
    });

    describe('nested components', () => {
        it('calls a component tag with props and children', () => {
            const Card: CompiledComponent = compileComponent(
                'const Card = ({ className, children }) => <section className={className}>{children}</section>;'
            );
            const html: string = renderComponent(
                'const A = ({ title }) => <Card className="c">{title}</Card>;',
                { title: 'Hello' },
                { Card }
            );
            expect(html).toBe('<section class="c">Hello</section>');
        });
    });
});