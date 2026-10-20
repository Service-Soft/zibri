import { describe, expect, it } from 'vitest';

import { renderWithComponents } from '../__testing__/server-render.helper.ts';

// A section hands layout values down to its columns without threading them through every level as
// props. The value is provided during the section's render and read while its children render, then
// dropped once the section is done - so it is dynamic (read where a component renders), not lexical.
describe('render context', () => {
    it('reads a value an ancestor provided', () => {
        const html: string = renderWithComponents(
            'const Page = () => { const Ctx = createContext({ align: \'left\' }); '
            + 'provideContext(Ctx, { align: \'right\' }); return <Col ctx={Ctx}/>; };',
            { Col: 'const Col = ({ ctx }) => { const v = useContext(ctx); return <div>{v.align}</div>; };' }
        ).html;
        expect(html).toBe('<div>right</div>');
    });

    it('falls back to the default when nothing provided one', () => {
        const html: string = renderWithComponents(
            'const Page = () => { const Ctx = createContext({ align: \'left\' }); return <Col ctx={Ctx}/>; };',
            { Col: 'const Col = ({ ctx }) => { const v = useContext(ctx); return <div>{v.align}</div>; };' }
        ).html;
        expect(html).toBe('<div>left</div>');
    });

    it('lets a component override the inherited value with its own prop', () => {
        // The whole point of override: normally columns look like the section says, but this one is
        // a bit different.
        const html: string = renderWithComponents(
            'const Page = () => { const Ctx = createContext({ align: \'left\' }); '
            + 'provideContext(Ctx, { align: \'center\' }); '
            + 'return <div>{[undefined, \'right\'].map(a => <Col ctx={Ctx} align={a}/>)}</div>; };',
            {
                Col: 'const Col = ({ ctx, align }) => { const v = useContext(ctx); '
                    + 'return <span>{align ? align : v.align}</span>; };'
            }
        ).html;
        expect(html).toBe('<div><span>center</span><span>right</span></div>');
    });

    it('takes the nearest provider when they nest', () => {
        const html: string = renderWithComponents(
            'const Page = () => { const Ctx = createContext({ w: \'0\' }); provideContext(Ctx, { w: \'outer\' }); '
            + 'return <Outer ctx={Ctx}/>; };',
            {
                Leaf: 'const Leaf = ({ ctx }) => <span>{useContext(ctx).w}</span>;',
                Outer: 'const Outer = ({ ctx }) => { provideContext(ctx, { w: \'inner\' }); '
                    + 'return <div>{useContext(ctx).w}<Leaf ctx={ctx}/></div>; };'
            }
        ).html;
        expect(html).toBe('<div>inner<span>inner</span></div>');
    });

    it('stops seeing a value once the providing component is done rendering', () => {
        // Two siblings: the first provides, the second must not inherit it.
        const html: string = renderWithComponents(
            'const Page = () => { const Ctx = createContext({ w: \'default\' }); '
            + 'return <div><Provider ctx={Ctx}/><Reader ctx={Ctx}/></div>; };',
            {
                Provider: 'const Provider = ({ ctx }) => { provideContext(ctx, { w: \'scoped\' }); '
                    + 'return <b>{useContext(ctx).w}</b>; };',
                Reader: 'const Reader = ({ ctx }) => <i>{useContext(ctx).w}</i>;'
            }
        ).html;
        expect(html).toBe('<div><b>scoped</b><i>default</i></div>');
    });

    it('keeps two contexts independent', () => {
        const html: string = renderWithComponents(
            'const Page = () => { const A = createContext(\'a0\'); const B = createContext(\'b0\'); '
            + 'provideContext(A, \'a1\'); provideContext(B, \'b1\'); return <Col a={A} b={B}/>; };',
            { Col: 'const Col = ({ a, b }) => <div>{useContext(a)}-{useContext(b)}</div>;' }
        ).html;
        expect(html).toBe('<div>a1-b1</div>');
    });
});