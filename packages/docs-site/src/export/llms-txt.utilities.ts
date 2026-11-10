import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DocsUtilities } from 'zibri';

import { BASE_PATH } from '../base-path';
import { DOCS_DIR } from '../docs-dir';
import { DOCS_SITE } from '../navigation/docs-site';

// The pages are written for a developer and for the assistant that developer asks. An assistant finds the pages of a
// site through llms.txt, an index of each page and what it is, and reads them all at once in llms-full.txt
// (llmstxt.org). Both are built from the pages themselves, in the order of the site.

const SITE_ORIGIN: string = 'https://service-soft.github.io';

const SUMMARY: string = 'Zibri is an opinionated TypeScript backend framework based on express: routes, data sources, auth, '
    + 'tenants, background work and the rest of an API, declared once and read everywhere.';

/**
 * A page as an assistant reads it.
 */
type LlmsPage = {
    title: string,
    url: string,
    content: string
};

/**
 * Writes the index of the pages for an assistant, and all of them in one file.
 */
export abstract class LlmsTxtUtilities {
    /**
     * The index of the pages: each with its title, its address and the first sentence of its intro.
     * @returns The content of llms.txt.
     */
    static resolveLlmsTxt(): string {
        const lines: string[] = [
            '# Zibri',
            '',
            `> ${SUMMARY}`,
            '',
            `Every page below, whole, is in [llms-full.txt](${SITE_ORIGIN}${BASE_PATH}/llms-full.txt).`,
            '',
            '## Docs',
            ''
        ];
        for (const page of this.resolvePages()) {
            lines.push(`- [${page.title}](${page.url}): ${this.resolveDescription(page.content)}`);
        }
        return `${lines.join('\n')}\n`;
    }

    /**
     * Every page whole, each under its address.
     * @returns The content of llms-full.txt.
     */
    static resolveLlmsFullTxt(): string {
        const pages: string[] = this.resolvePages().map(page => `<!-- ${page.url} -->\n\n${page.content}`);
        return `${pages.join('\n\n---\n\n')}\n`;
    }

    private static resolvePages(): LlmsPage[] {
        return DocsUtilities.resolvePages(DOCS_SITE).map(page => ({
            title: DocsUtilities.resolveTitle(page),
            url: `${SITE_ORIGIN}${DocsUtilities.resolveAddress(DOCS_SITE, page.file)}`,
            // the page as a reader reads it, without the frontmatter for the site
            content: readFileSync(path.join(DOCS_DIR, page.file), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '')
                .trim()
        }));
    }

    /**
     * The first sentence of the paragraph under the title, with links as their text. A paragraph that leads into a list
     * ends where the list starts, and says so with a full stop.
     * @param content - The markdown of the page.
     * @returns The sentence.
     */
    private static resolveDescription(content: string): string {
        const lines: string[] = content.split('\n').slice(1);
        const start: number = lines.findIndex(line => line.trim() !== '');
        const end: number = lines.findIndex((line, index) => index > start && (line.trim() === '' || /^\s*([-|]|```)/.test(line)));
        const intro: string = lines.slice(start, end === -1 ? undefined : end).join(' ')
            .replaceAll(/\[([^\]]*)]\([^)]*\)/g, '$1');
        const sentence: RegExpExecArray | null = /^(.+?\.)(\s|$)/.exec(intro);
        return (sentence?.[1] ?? intro).trim().replace(/:$/, '.');
    }
}