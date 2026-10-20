import { describe, expect, it } from 'vitest';

import { renderPage } from './render-page.ts';
import { compilePage } from '../__testing__/server-render.helper.ts';

/**
 * A value as it arrives from outside: through json, which can hold any plain object.
 * @param json - The json.
 * @returns What it parses to.
 */
function fromJson(json: string): unknown {
    return JSON.parse(json);
}

describe('the server runtime, handed values that came in as json', () => {
    it('escapes an object that only looks like trusted html', () => {
        const page: string = 'const Home = ({ bio }) => <html><body><div>{bio}</div></body></html>;';

        // a json column, an anyOf body or a provider's answer can hold this shape
        const out: string = renderPage(compilePage(page), { bio: fromJson('{ "__raw": "<img src=x onerror=alert(1)>" }') });

        expect(out).not.toContain('<img');
    });

    it('writes an object that only looks like a client-prop reference as data, not as code', () => {
        const page: string = 'const Home = ({ name }) => { onClient(() => { track(name); }); return <html><body></body></html>; };';
        const forged: unknown = fromJson('{ "__propMarker": true, "site": "s", "id": "x", "captured": [], "owner": "0;alert(1)//" }');

        const out: string = renderPage(compilePage(page), { name: forged });

        // the reference is written into the script as a lookup on the owner's binding, unquoted
        expect(out).not.toContain('__ssrInstance0;alert(1)');
    });

    it('renders no inline event handler from a spread, whatever the case of its name', () => {
        const page: string = 'const Home = ({ extra }) => <html><body><div {...extra}></div></body></html>;';

        const out: string = renderPage(compilePage(page), { extra: { onclick: 'alert(1)', ONLOAD: 'alert(2)', title: 'kept' } });

        expect(out.toLowerCase()).not.toContain('onclick');
        expect(out.toLowerCase()).not.toContain('onload');
        expect(out).toContain('title="kept"');
    });

    it('renders no attribute whose name could write attributes of its own', () => {
        const page: string = 'const Home = ({ extra }) => <html><body><div {...extra}></div></body></html>;';

        const out: string = renderPage(compilePage(page), { extra: { 'x onmouseover': 'alert(1)', 'a"b': 'c', 'd=e': 'f', 'g>h': 'i' } });

        expect(out).toContain('<div></div>');
    });

    it('renders no javascript url, however it is spelled', () => {
        const page: string = 'const Home = ({ links }) => <html><body>{links.map(link => <a href={link}>x</a>)}</body></html>;';

        const out: string = renderPage(compilePage(page), {
            links: ['javascript:alert(1)', ' JaVaScRiPt:alert(2)', 'java\tscript:alert(3)', 'https://example.com/']
        });

        expect(out.toLowerCase()).not.toContain('script:');
        expect(out).toContain('href="https://example.com/"');
    });
});