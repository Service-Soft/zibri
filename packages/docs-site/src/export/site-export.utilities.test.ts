// cspell:ignore haspermission -- the anchor of a member, its name in lowercase
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DocsUtilities, UUIDUtilities } from 'zibri';
import { StartedTestServer } from 'zibri-testing';

import { SiteExport } from './site-export.model';
import { SiteExportUtilities } from './site-export.utilities';
import { startDocsSite } from '../__testing__/start-docs-site.function';
import { DOCS_SITE } from '../navigation/docs-site';

/**
 * A folder of its own for one export.
 * @param purpose - What the export is for.
 * @returns The folder, below the output of the tests.
 */
function resolveOutDir(purpose: string): string {
    return path.join(__dirname, '..', '__testing__', 'file-output', `${purpose}-${UUIDUtilities.generate()}`);
}

describe('the export of the site', () => {
    let server: StartedTestServer;
    let exported: SiteExport;
    const outDir: string = resolveOutDir('export');

    beforeAll(async () => {
        server = await startDocsSite();
        exported = await SiteExportUtilities.exportAll(await server.start(), outDir);
    }, 120_000);

    afterAll(async () => {
        await server.shutdown();
        rmSync(outDir, { recursive: true, force: true });
    }, 30_000);

    it('leads nowhere from no link of any page', () => {
        expect(exported.problems).toEqual([]);
    });

    it('writes every page as the index of the folder of its address, with the files the pages name', () => {
        const pageFiles: string[] = DocsUtilities.resolvePages(DOCS_SITE)
            .map(page => `${DocsUtilities.resolveAddress(DOCS_SITE, page.file).replace(/^\/zibri\//, '')}index.html`);

        expect(exported.files).toEqual(expect.arrayContaining([
            ...pageFiles,
            'assets/style.css',
            'assets/favicon.png',
            'assets/github.svg',
            'api/index.html',
            'api/MarkdownService/index.html',
            'images/endpoints/assets-explorer.png'
        ]));
        expect(readFileSync(path.join(outDir, 'auth', 'passkeys', 'index.html'), 'utf8')).toContain('<title>Passkeys | Zibri</title>');
    });

    it('writes the index of the pages for an assistant, each page under its address, and all of them whole', () => {
        const index: string = readFileSync(path.join(outDir, 'llms.txt'), 'utf8');
        const full: string = readFileSync(path.join(outDir, 'llms-full.txt'), 'utf8');

        expect(index).toContain('- [Passkeys](https://service-soft.github.io/zibri/auth/passkeys/): ');
        expect(index.split('\n').filter(line => line.startsWith('- ['))).toHaveLength(DocsUtilities.resolvePages(DOCS_SITE).length);
        expect(full).toContain('<!-- https://service-soft.github.io/zibri/auth/passkeys/ -->\n\n# Passkeys');
    });

    it('sends a reader from the address 3.0 gave a page on to the page, with the heading the link names', () => {
        const stub: string = readFileSync(path.join(outDir, 'documents', 'passkeys.html'), 'utf8');

        expect(stub).toContain('location.replace("/zibri/auth/passkeys/" + location.hash)');
        expect(stub).toContain('<meta http-equiv="refresh" content="0; url=/zibri/auth/passkeys/">');
        expect(existsSync(path.join(outDir, 'documents', 'getting-started.html'))).toBe(true);
    });

    // addresses typedoc wrote for 3.1, the page of a member of a namespace and two names differing in case among them
    it.each([
        ['classes/MarkdownService.html', '/zibri/api/MarkdownService/'],
        ['modules/Auth.html', '/zibri/api/Auth/'],
        ['variables/Auth.hasPermission.html', '/zibri/api/Auth/#haspermission'],
        ['interfaces/BigNumber.Config.html', '/zibri/api/BigNumber/#config'],
        ['functions/_ts.html', '/zibri/api/$ts/'],
        ['functions/inject.html', '/zibri/api/inject/'],
        ['functions/Inject-1.html', '/zibri/api/Inject/'],
        ['types/CurrentUser.html', '/zibri/api/CurrentUser/'],
        ['functions/CurrentUser.html', '/zibri/api/CurrentUser/'],
        ['hierarchy.html', '/zibri/api/']
    ])('sends a reader from the page typedoc wrote at %s on to %s', (from, to) => {
        expect(readFileSync(path.join(outDir, from), 'utf8')).toContain(`location.replace(${JSON.stringify(to)} + location.hash)`);
    });
});

describe('the links the export follows', () => {
    // a site of its own, holding every way a link leads nowhere
    const pages: Record<string, { type: string, body: string }> = {
        '/zibri/': {
            type: 'text/html',
            body: '<a href="/zibri/a/">a</a> <a href="/zibri/a/#heading">heading</a> <a href="/zibri/a/#gone">gone</a> '
                + '<a href="/zibri/missing/">missing</a> <a href="/elsewhere/">elsewhere</a> <a href="/zibri/b">b</a> '
                + '<a href="https://example.com/">external</a> <link rel="stylesheet" href="style.css">'
        },
        '/zibri/a/': { type: 'text/html', body: '<h2 id="heading">Heading</h2>' },
        '/zibri/b': { type: 'text/html', body: '<p>b</p>' },
        '/zibri/style.css': { type: 'text/css', body: 'body { background: url("/zibri/font.woff"); }' }
    };
    let site: Server;
    let origin: string;

    beforeAll(async () => {
        site = createServer((request, response) => {
            const page: { type: string, body: string } | undefined = pages[request.url ?? ''];
            response.writeHead(page === undefined ? 404 : 200, { 'content-type': page?.type ?? 'text/plain' });
            response.end(page?.body ?? 'not found');
        });
        await new Promise<void>(resolve => site.listen(0, resolve));
        const address: AddressInfo | string | null = site.address();
        if (address === null || typeof address === 'string') {
            throw new Error('The site listens on no port.');
        }
        origin = `http://localhost:${address.port}`;
    });

    afterAll(async () => {
        await new Promise(resolve => site.close(resolve));
    });

    it('reports each link that leads nowhere, naming the page it is on', async () => {
        const outDir: string = resolveOutDir('broken-links');
        const exported: SiteExport = await SiteExportUtilities.exportSite(origin, outDir);
        rmSync(outDir, { recursive: true, force: true });

        expect([...exported.problems].sort()).toEqual([
            '/zibri/ links /elsewhere/, which is outside the site at /zibri/.',
            '/zibri/ links /zibri/a/#gone, and /zibri/a/ holds no element with the id \'gone\'.',
            '/zibri/ links /zibri/missing/, which answers 404.',
            '/zibri/ links the page /zibri/b without the slash it is published under.',
            '/zibri/style.css links /zibri/font.woff, which answers 404.'
        ].sort());
        expect([...exported.files].sort()).toEqual(['a/index.html', 'index.html', 'style.css']);
    });
});