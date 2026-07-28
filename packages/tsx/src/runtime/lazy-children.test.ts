import { describe, expect, it } from '@jest/globals';

import { RenderResult, renderWithComponents } from '../__testing__/server-render.helper';

const BUTTON: string = '<Card><button onClick={greet}>Hi</button></Card>';

/**
 * Wraps markup in a page that declares a handler, so the registries show when and on whose behalf
 * the children were rendered.
 * @param markup - The page's markup.
 * @returns The page source.
 */
function page(markup: string): string {
    return `const Page = () => { const greet = () => alert('hi'); return ${markup}; };`;
}

// Children used to be rendered into html before the component they were passed to even ran, which
// makes it impossible for a component to establish anything its children depend on - the layout
// values an email section hands down to its columns, for example. They are passed as a thunk now and
// render at the point the component reads them.
describe('lazy children', () => {
    it('renders children where the component reads them', () => {
        const result: RenderResult = renderWithComponents(
            page('<Card><span>inner</span></Card>'),
            { Card: 'const Card = ({ children }) => <div class="card">{children}</div>;' }
        );
        expect(result.html).toBe('<div class="card"><span>inner</span></div>');
    });

    it('never renders children a component does not read', () => {
        const result: RenderResult = renderWithComponents(
            page(BUTTON),
            { Card: 'const Card = () => <div class="card"/>;' }
        );
        expect(result.html).toBe('<div class="card"></div>');
        // The handler proves it: an eagerly rendered child would have registered one anyway.
        expect(result.handlers).toEqual([]);
    });

    it('renders children once when a component reads them twice', () => {
        const result: RenderResult = renderWithComponents(
            page(BUTTON),
            { Card: 'const Card = ({ children }) => <div>{children}{children}</div>;' }
        );
        expect(result.html).toContain('Hi</button><button');
        // Rendering the thunk per read would register the same handler site twice.
        expect(result.handlers).toHaveLength(1);
    });

    it('attributes a handler in the children to the component that wrote it', () => {
        const result: RenderResult = renderWithComponents(
            page(BUTTON),
            { Card: 'const Card = ({ children }) => <div class="card">{children}</div>;' }
        );
        // The handler lives in the page's client setup, so it has to stay owned by the page (0) even
        // though it now renders while Card is the component in progress.
        expect(result.handlers).toHaveLength(1);
        expect(result.handlers[0].owner).toBe(0);
    });

    it('keeps captured loop values with the instance that declared them', () => {
        const result: RenderResult = renderWithComponents(
            page('<ul>{[\'a\', \'b\'].map(id => <Card><button onClick={() => pick(id)}>{id}</button></Card>)}</ul>'),
            { Card: 'const Card = ({ children }) => <li>{children}</li>;' }
        );
        expect(result.handlers.map(h => h.captured)).toEqual([['a'], ['b']]);
        expect(result.handlers.every(h => h.owner === 0)).toBe(true);
    });

    it('still serializes a text child a client setup reads', () => {
        // Static text cannot depend on anything the component establishes, so it stays an ordinary
        // eager prop - making it lazy would drop it from the page for no gain.
        const result: RenderResult = renderWithComponents(
            page('<Label>Save</Label>'),
            { Label: 'const Label = ({ children }) => { onClient(() => { report(children); }); return <span>{children}</span>; };' }
        );
        expect(result.instances).toHaveLength(1);
        expect(result.instances[0].props).toEqual({ children: 'Save' });
    });
});