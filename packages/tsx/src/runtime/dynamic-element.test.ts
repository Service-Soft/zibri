import { describe, expect, it } from '@jest/globals';

import { renderComponent, renderComponentResult, RenderResult, renderWithComponents } from '../__testing__/server-render.helper';

// A capitalized identifier holding a tag name is valid tsx, and indistinguishable from a component
// at compile time — the compiler lowers both to `$ssr.component`, so the runtime resolves the
// element case. Getting this wrong renders nothing and throws, which is how it was found in the
// sandbox's Heading component.
describe('dynamic tag names', () => {
    it('renders a tag name held by a capitalized const', () => {
        const source: string = 'const Heading = ({ tag = \'h1\', children }) => { const TagName = tag; '
            + 'return <TagName>{children}</TagName>; };';
        expect(renderComponent(source, { children: 'Title' })).toBe('<h1>Title</h1>');
    });

    it('uses the tag passed in as a prop', () => {
        const source: string = 'const Heading = ({ tag = \'h1\', children }) => { const TagName = tag; '
            + 'return <TagName>{children}</TagName>; };';
        expect(renderComponent(source, { tag: 'h3', children: 'Sub' })).toBe('<h3>Sub</h3>');
    });

    it('renders attributes and escapes their values', () => {
        const source: string = 'const Heading = ({ tag, id, children }) => { const TagName = tag; '
            + 'return <TagName id={id} className="a b">{children}</TagName>; };';
        expect(renderComponent(source, { tag: 'h2', id: 'x"y', children: 'T' }))
            .toBe('<h2 id="x&quot;y" class="a b">T</h2>');
    });

    it('escapes dynamic children', () => {
        const source: string = 'const Heading = ({ tag, children }) => { const TagName = tag; '
            + 'return <TagName>{children}</TagName>; };';
        expect(renderComponent(source, { tag: 'p', children: '<script>x</script>' }))
            .toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
    });

    it('drops undefined and false attributes', () => {
        const source: string = 'const El = ({ tag, id, hidden }) => { const TagName = tag; '
            + 'return <TagName id={id} hidden={hidden}></TagName>; };';
        expect(renderComponent(source, { tag: 'div', id: undefined, hidden: false })).toBe('<div></div>');
    });

    it('renders a boolean attribute without a value', () => {
        const source: string = 'const El = ({ tag, hidden }) => { const TagName = tag; '
            + 'return <TagName hidden={hidden}></TagName>; };';
        expect(renderComponent(source, { tag: 'div', hidden: true })).toBe('<div hidden></div>');
    });

    it('renders a style object', () => {
        const source: string = 'const El = ({ tag }) => { const TagName = tag; '
            + 'return <TagName style={{ backgroundColor: \'red\' }}></TagName>; };';
        expect(renderComponent(source, { tag: 'div' })).toBe('<div style="background-color:red"></div>');
    });

    it('self closes a void element without emitting a closing tag', () => {
        const source: string = 'const El = ({ tag, src }) => { const TagName = tag; return <TagName src={src}/>; };';
        expect(renderComponent(source, { tag: 'img', src: '/a.png' })).toBe('<img src="/a.png">');
    });

    it('renders nested elements and components as children', () => {
        const card: string = 'const Card = ({ children }) => <section>{children}</section>;';
        const page: string = 'const Page = ({ tag }) => { const TagName = tag; '
            + 'return <TagName><Card><b>deep</b></Card></TagName>; };';
        const result: RenderResult = renderWithComponents(page, { Card: card }, { tag: 'main' });
        expect(result.html).toBe('<main><section><b>deep</b></section></main>');
    });

    it('stamps an event handler declared on the dynamic element', () => {
        const source: string = 'const El = ({ tag }) => { function pick() { chose(); } '
            + 'const TagName = tag; return <TagName onClick={pick}>x</TagName>; };';
        const result: RenderResult = renderComponentResult(source, { tag: 'button' });

        expect(result.html).toContain('data-ssr-handlers="h0_0:click"');
        // The handler must not leak into the markup as an attribute.
        expect(result.html).not.toContain('onClick');
        expect(result.handlers).toHaveLength(1);
        expect(result.handlers[0].event).toBe('click');
    });

    it('stamps a handler that was passed into the component as a prop', () => {
        const button: string = 'const Button = ({ tag, onClick, children }) => { const TagName = tag; '
            + 'return <TagName onClick={onClick}>{children}</TagName>; };';
        const page: string = 'const Page = () => { function pick() { chose(); } '
            + 'return <div><Button tag="button" onClick={pick}>Go</Button></div>; };';
        const result: RenderResult = renderWithComponents(page, { Button: button });

        expect(result.html).toContain('data-ssr-handlers=');
        expect(result.handlers).toHaveLength(1);
    });

    it('omits the stamp when a handler prop was not provided', () => {
        const source: string = 'const El = ({ tag, onClick }) => { const TagName = tag; '
            + 'return <TagName onClick={onClick}>x</TagName>; };';
        expect(renderComponent(source, { tag: 'button' })).toBe('<button>x</button>');
    });

    it('still renders a real component when the identifier holds one', () => {
        const card: string = 'const Card = ({ children }) => <section>{children}</section>;';
        const page: string = 'const Page = () => <Card>content</Card>;';
        expect(renderWithComponents(page, { Card: card }).html).toBe('<section>content</section>');
    });
});