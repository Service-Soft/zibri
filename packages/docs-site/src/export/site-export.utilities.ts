import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { LlmsTxtUtilities } from './llms-txt.utilities';
import { RedirectUtilities } from './redirect.utilities';
import { SiteExport } from './site-export.model';
import { BASE_PATH } from '../base-path';
import { HtmlUtilities } from '../html/html.utilities';
import { SEARCH_INDEX_ADDRESS } from '../search/search-index.utilities';

/**
 * An address the export is to request, and the page that links it.
 */
type ExportRequest = {
    address: string,
    from: string
};

/**
 * A link to an element of a page, which that page has to hold.
 */
type AnchorLink = {
    address: string,
    fragment: string,
    from: string,
    link: string
};

// a link with a scheme, or to another host, leaves the site
const EXTERNAL_LINK: RegExp = /^(?:[a-z][\d+.a-z-]*:|\/\/)/i;

/**
 * Writes the site as files, the way a host without a server publishes it.
 */
export abstract class SiteExportUtilities {
    /**
     * Exports the running site: every page and file a reader reaches from its first page, the index of the pages for
     * an assistant, and the pages the addresses of earlier releases send on.
     * @param origin - Where the site runs, such as `http://localhost:4000`.
     * @param outDir - The folder to write it to, which is emptied first. It is what is published at the path of the site.
     * @returns What was written, and every link that leads nowhere.
     */
    static async exportAll(origin: string, outDir: string): Promise<SiteExport> {
        const site: SiteExport = await this.exportSite(origin, outDir, [`${BASE_PATH}/`, SEARCH_INDEX_ADDRESS]);
        const written: Record<string, string> = {
            'llms.txt': LlmsTxtUtilities.resolveLlmsTxt(),
            'llms-full.txt': LlmsTxtUtilities.resolveLlmsFullTxt(),
            ...Object.fromEntries(RedirectUtilities.resolveMovedPages().map(moved => [
                moved.from,
                RedirectUtilities.resolveRedirectPage(moved.to)
            ]))
        };
        for (const [file, content] of Object.entries(written)) {
            writeExportedFile(outDir, file, content);
        }
        return { files: [...site.files, ...Object.keys(written)], problems: site.problems };
    }

    /**
     * Exports what a reader reaches from the first page of the running site, following every link and file a page or
     * stylesheet names below the path of the site, and every address a file of json names there.
     * @param origin - Where the site runs.
     * @param outDir - The folder to write it to, which is emptied first.
     * @param starts - Where the export starts: the first page, and what a page fetches rather than links.
     * @returns What was written, and every link that leads nowhere: to an address that answers no file, outside the
     * site, or to an element its page does not hold.
     */
    static async exportSite(origin: string, outDir: string, starts: string[] = [`${BASE_PATH}/`]): Promise<SiteExport> {
        rmSync(outDir, { recursive: true, force: true });
        mkdirSync(outDir, { recursive: true });
        return await new SiteCrawl(origin, outDir, starts).run();
    }
}

/**
 * One export of the site, following its links from the first page.
 */
class SiteCrawl {
    private readonly requests: ExportRequest[];
    private readonly requested: Set<string>;
    private readonly idsByPage: Map<string, Set<string>> = new Map();
    private readonly anchorLinks: AnchorLink[] = [];
    private readonly files: string[] = [];
    private readonly problems: string[] = [];

    constructor(private readonly origin: string, private readonly outDir: string, starts: string[]) {
        this.requests = starts.map(address => ({ address, from: address }));
        this.requested = new Set(starts);
    }

    /**
     * Writes every address a reader reaches, then checks the elements the links name.
     * @returns What was written, and every link that leads nowhere.
     */
    async run(): Promise<SiteExport> {
        // the list grows while it is walked, by what each answer links
        for (const request of this.requests) {
            this.follow(await this.export(request), request.address);
        }
        for (const { address, fragment, from, link } of this.anchorLinks) {
            const ids: Set<string> | undefined = this.idsByPage.get(address);
            if (ids !== undefined && !ids.has(fragment)) {
                this.problems.push(`${from} links ${link}, and ${address} holds no element with the id '${fragment}'.`);
            }
        }
        return { files: this.files, problems: this.problems };
    }

    /**
     * Writes what one address answers.
     * @param request - The address, and the page linking it.
     * @returns What the answer links, as written.
     */
    private async export(request: ExportRequest): Promise<string[]> {
        const { address, from } = request;
        const file: string | undefined = resolveFile(address);
        if (file === undefined) {
            this.problems.push(`${from} links ${address}, which is outside the site at ${BASE_PATH}/.`);
            return [];
        }
        const response: Response = await fetch(`${this.origin}${address}`, { redirect: 'manual' });
        if (response.status !== 200) {
            this.problems.push(`${from} links ${address}, which answers ${response.status}.`);
            return [];
        }
        const contentType: string = response.headers.get('content-type') ?? '';
        if (contentType.startsWith('text/html') && !file.endsWith('index.html')) {
            this.problems.push(`${from} links the page ${address} without the slash it is published under.`);
            return [];
        }
        this.files.push(file);
        if (contentType.startsWith('text/html')) {
            const html: string = await response.text();
            writeExportedFile(this.outDir, file, html);
            this.idsByPage.set(address, new Set([...html.matchAll(/\sid="([^"]*)"/g)].map(match => HtmlUtilities.decode(match[1] ?? ''))));
            return [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)].map(match => HtmlUtilities.decode(match[1] ?? ''));
        }
        if (contentType.startsWith('text/css')) {
            const css: string = await response.text();
            writeExportedFile(this.outDir, file, css);
            return [...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(match => match[1] ?? '');
        }
        if (contentType.startsWith('application/json')) {
            // what the page fetches, such as the index of the search, whose addresses lead somewhere as a link does
            const json: string = await response.text();
            writeExportedFile(this.outDir, file, json);
            return [...json.matchAll(new RegExp(`"(${BASE_PATH}/[^"]*)"`, 'g'))].map(match => match[1] ?? '');
        }
        writeExportedFile(this.outDir, file, Buffer.from(await response.arrayBuffer()));
        return [];
    }

    /**
     * Requests what the links of an answer name below the site, once each, and remembers the elements they name.
     * @param links - The links, as written.
     * @param from - The address that holds them.
     */
    private follow(links: string[], from: string): void {
        for (const link of links) {
            if (link === '' || link === '#' || EXTERNAL_LINK.test(link)) {
                continue;
            }
            const url: URL = new URL(link, `http://site${from}`);
            const fragment: string = decodeURIComponent(url.hash.slice(1));
            if (fragment !== '') {
                this.anchorLinks.push({ address: url.pathname, fragment, from, link });
            }
            if (!this.requested.has(url.pathname)) {
                this.requested.add(url.pathname);
                this.requests.push({ address: url.pathname, from });
            }
        }
    }
}

/**
 * The file an address of the site is published as: a page as the `index.html` of its folder.
 * @param address - The address, such as `/zibri/auth/passkeys/`.
 * @returns The file below the folder of the export, or undefined for an address outside the site.
 */
function resolveFile(address: string): string | undefined {
    if (!address.startsWith(`${BASE_PATH}/`)) {
        return undefined;
    }
    const file: string = decodeURIComponent(address.slice(BASE_PATH.length + 1));
    return file === '' || file.endsWith('/') ? `${file}index.html` : file;
}

/**
 * Writes a file of the export, and the folders it is in.
 * @param outDir - The folder of the export.
 * @param file - The file below it.
 * @param content - What it holds.
 */
function writeExportedFile(outDir: string, file: string, content: string | Buffer): void {
    const target: string = path.join(outDir, file);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
}