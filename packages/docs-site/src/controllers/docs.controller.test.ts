import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DocsPage, DocsUtilities } from 'zibri';
import { StartedTestServer } from 'zibri-testing';

import { startDocsSite } from '../__testing__/start-docs-site.function';
import { DOCS_SITE } from '../navigation/docs-site';

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startDocsSite();
    baseUrl = await server.start();
}, 60_000);

afterAll(async () => {
    await server.shutdown();
}, 30_000);

describe('the pages of the site', () => {
    // one request per page, as the export makes them
    const pages: [string, DocsPage][] = DocsUtilities.resolvePages(DOCS_SITE).map(page => [page.file, page]);

    it.each(pages)('answers %s at its address, titled by its first heading', async (_, page) => {
        const response: Response = await fetch(`${baseUrl}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`);
        const html: string = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain(`<title>${DocsUtilities.resolveTitle(page)} | Zibri</title>`);
    });

    it('links no page by its file, as only the sources are read on GitHub', async () => {
        const linkingFiles: string[] = [];
        for (const page of DocsUtilities.resolvePages(DOCS_SITE)) {
            const html: string = await (await fetch(`${baseUrl}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`)).text();
            for (const [, href] of html.matchAll(/href="([^"]*)"/g)) {
                if (href !== undefined && /\.md(#|$)/.test(href) && !href.startsWith('http')) {
                    linkingFiles.push(`${page.file}: ${href}`);
                }
            }
        }

        expect(linkingFiles).toEqual([]);
    }, 60_000);

    it('renders every alert as one, never the line naming it as text', async () => {
        const html: string = await (await fetch(`${baseUrl}/zibri/data/data-source/`)).text();
        const pagesShowingMarkers: string[] = [];
        for (const page of DocsUtilities.resolvePages(DOCS_SITE)) {
            const pageHtml: string = await (await fetch(`${baseUrl}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`)).text();
            if (/<p[^>]*>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/.test(pageHtml)) {
                pagesShowingMarkers.push(page.file);
            }
        }

        expect(html).toContain('>Warning</p>');
        expect(pagesShowingMarkers).toEqual([]);
    }, 60_000);

    it('marks the page in the sidebar, and opens its folder', async () => {
        const html: string = await (await fetch(`${baseUrl}/zibri/auth/passkeys/`)).text();

        expect(html).toContain('href="/zibri/auth/passkeys/" aria-current="page"');
        expect(html).toMatch(/<details open[^>]*><summary[^>]*>Auth<\/summary>/);
    });

    it('answers 404 where no page is, the first page included under its file name', async () => {
        expect((await fetch(`${baseUrl}/zibri/auth/nothing/`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/zibri/getting-started/`)).status).toBe(404);
    });

    it('serves the stylesheet below the path of the site', async () => {
        expect((await fetch(`${baseUrl}/zibri/assets/style.css`)).status).toBe(200);
    });

    it('shows the logos of Zibri and GitHub in the bar, served below the path of the site', async () => {
        const html: string = await (await fetch(`${baseUrl}/zibri/`)).text();
        const github: Response = await fetch(`${baseUrl}/zibri/assets/github.svg`);

        expect(html).toContain('<img src="/zibri/assets/favicon.png" alt=""');
        expect(html).toContain('<img src="/zibri/assets/github.svg" alt="GitHub"');
        expect(github.status).toBe(200);
        expect(github.headers.get('content-type')).toContain('image/svg+xml');
    });

    it('serves an image beside its page, and nothing outside the folders of the pages', async () => {
        const image: Response = await fetch(`${baseUrl}/zibri/images/endpoints/assets-explorer.png`);

        expect(image.status).toBe(200);
        expect(image.headers.get('content-type')).toBe('image/png');
        expect((await fetch(`${baseUrl}/zibri/images/endpoints/assets.md`)).status).toBe(404);
        expect((await fetch(`${baseUrl}/zibri/images/${encodeURIComponent('../..')}/package.json`)).status).toBe(404);
    });
});

describe('the API reference', () => {
    /**
     * A page of the reference, which answers.
     * @param address - Its address below the reference, such as `MarkdownService/`.
     * @returns Its html.
     */
    async function fetchApiPage(address: string): Promise<string> {
        const response: Response = await fetch(`${baseUrl}/zibri/api/${address}`);
        expect(response.status).toBe(200);
        return await response.text();
    }

    it('lists every export by kind, each leading to its page, and is marked in the sidebar', async () => {
        const html: string = await fetchApiPage('');

        expect(html).toContain('<title>API reference | Zibri</title>');
        expect(html).toContain('href="/zibri/api/" aria-current="page"');
        // the heading, and the link copying its address
        expect(html).toMatch(/<h2[^>]* id="entity"[^>]*>Entities<a[^>]* href="#entity"/);
        expect(html).toContain('href="/zibri/api/MarkdownService/"');
    });

    it('shows how an export is declared, its JSDoc, and each member under an anchor of its own', async () => {
        const html: string = await fetchApiPage('MarkdownService/');

        expect(html).toContain('<title>MarkdownService | Zibri</title>');
        expect(html).toContain('<span class="shiki-token-keyword">class </span>');
        expect(html).toContain('href="/zibri/api/MarkdownServiceInterface/"');
        expect(html).toContain('renders markdown with the package');
        expect(html).toMatch(/<h3[^>]* id="resolvepage"[^>]*>resolvePage</);
        expect(html).toContain('>Throws</strong>');
    });

    it('links an export a comment links to its page', async () => {
        expect(await fetchApiPage('MarkdownProps/')).toContain('href="/zibri/api/Markdown/"');
    });

    it('marks a class zibri stores as rows as an entity, and another as a class', async () => {
        expect(await fetchApiPage('Passkey/')).toContain('<span class="sr-only">entity</span>');
        expect(await fetchApiPage('MarkdownService/')).toContain('<span class="sr-only">class</span>');
    });

    it('shows each thing a name declares, what its badge shows first', async () => {
        const html: string = await fetchApiPage('Body/');

        expect(html.indexOf('>function </span>')).toBeGreaterThan(-1);
        expect(html.indexOf('>function </span>')).toBeLessThan(html.indexOf('>namespace </span>'));
        expect(html).toMatch(/<h3[^>]* id="oneof"/);
    });

    it('links code naming an export to its page with its kind, on a page and in a comment, a member to its section', async () => {
        const page: string = await (await fetch(`${baseUrl}/zibri/auth/passkeys/`)).text();
        const comment: string = await fetchApiPage('MarkdownService/');

        expect(page).toMatch(/<a href="\/zibri\/api\/Passkey\/"[^>]*>(?:(?!<\/a>)[\s\S])*<span class="sr-only">entity<\/span>/);
        expect(page).toContain('href="/zibri/api/ZIBRI_DI_TOKENS/#passkey_options"');
        expect(comment).toContain('href="/zibri/api/ZIBRI_DI_TOKENS/#markdown_options"');
    });

    it('links no code inside a link a second time', async () => {
        const html: string = await fetchApiPage('MarkdownProps/');

        expect(html).toContain('href="/zibri/api/Markdown/"');
        expect(html).not.toMatch(/<a [^>]*>(?:(?!<\/a>)[\s\S])*<a /);
    });

    it('answers 404 for a name zibri does not export', async () => {
        expect((await fetch(`${baseUrl}/zibri/api/NothingByThisName/`)).status).toBe(404);
    });
});