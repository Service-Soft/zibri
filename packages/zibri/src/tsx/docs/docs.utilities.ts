import path from 'node:path';

import { MdxHeading } from 'zibri-tsx';

import { DocsSearchEntry } from './docs-search-entry.model';
import { DocsNavigationEntry, DocsPage, DocsSite } from './docs-site.model';

/**
 * Where the pages of a documentation are, what they are called, and what its search finds.
 */
export abstract class DocsUtilities {
    /**
     * Every page, in the order of the navigation.
     * @param site - The documentation.
     * @returns The pages.
     */
    static resolvePages(site: DocsSite): DocsPage[] {
        return site.navigation.flatMap(entry => this.isPage(entry) ? [entry] : entry.pages);
    }

    /**
     * Finds the page at an address.
     * @param site - The documentation.
     * @param address - The address, such as `/docs/guides/writing-a-page/`.
     * @returns The page, or undefined when none is there.
     */
    static findPageAt(site: DocsSite, address: string): DocsPage | undefined {
        const wanted: string = address.endsWith('/') ? address : `${address}/`;
        return this.resolvePages(site).find(page => this.resolveAddress(site, page.file) === wanted);
    }

    /**
     * The address of a page, which follows its file: `guides/writing-a-page.md` is at `/docs/guides/writing-a-page/`,
     * and the home page at the base path.
     * @param site - The documentation.
     * @param file - The file of the page.
     * @returns The address.
     */
    static resolveAddress(site: DocsSite, file: string): string {
        return file === site.homePage ? `${site.basePath}/` : `${site.basePath}/${file.replace(/\.mdx?$/, '')}/`;
    }

    /**
     * The address a link of a page leads to: a page linked by its file, such as `../getting-started.md#installing-it`,
     * with the anchor it names, and anything else as it is written.
     * @param site - The documentation.
     * @param href - What the link names.
     * @param from - The file of the page holding the link.
     * @returns The address.
     */
    static resolveLink(site: DocsSite, href: string, from: string): string {
        const match: RegExpExecArray | null = /^(\.{1,2}\/[^#]*\.mdx?)(#.*)?$/.exec(href);
        if (match?.[1] == undefined) {
            return href;
        }
        const file: string = path.posix.normalize(path.posix.join(path.posix.dirname(from), match[1]));
        return `${this.resolveAddress(site, file)}${match[2] ?? ''}`;
    }

    /**
     * The title of a page: its first heading, or its file when it has none.
     * @param page - The page.
     * @returns The title.
     */
    static resolveTitle(page: DocsPage): string {
        const title: MdxHeading | undefined = page.module.headings.find(heading => heading.depth === 1);
        return title?.text ?? page.file;
    }

    /**
     * Whether an entry of the navigation is a page and not a folder.
     * @param entry - The entry.
     * @returns True for a page.
     */
    static isPage(entry: DocsNavigationEntry): entry is DocsPage {
        return 'file' in entry;
    }

    /**
     * What the search looks through: every page, found by its title and its keywords, and every section of one under
     * a `##` or `###` heading.
     * @param site - The documentation.
     * @returns The entries, each page before its sections.
     */
    static resolveSearchEntries(site: DocsSite): DocsSearchEntry[] {
        return site.navigation.flatMap(entry => this.isPage(entry)
            ? this.resolvePageEntries(site, entry, site.title)
            : entry.pages.flatMap(page => this.resolvePageEntries(site, page, entry.title)));
    }

    /**
     * Where the browser fetches what the search looks through. Three parts below the base path, so no page has the
     * same address.
     * @param site - The documentation.
     * @returns The address.
     */
    static resolveSearchIndexAddress(site: DocsSite): string {
        return `${site.basePath}/search/v1/index.json`;
    }

    // a page in its folder, and its sections on it
    private static resolvePageEntries(site: DocsSite, page: DocsPage, folder: string): DocsSearchEntry[] {
        const title: string = this.resolveTitle(page);
        const address: string = this.resolveAddress(site, page.file);
        return [
            { title, address, context: folder, keywords: this.resolveKeywords(page) },
            ...page.module.headings
                .filter(heading => heading.depth === 2 || heading.depth === 3)
                .map(heading => ({ title: heading.text, address: `${address}#${heading.id}`, context: title, keywords: [] }))
        ];
    }

    // the keywords of the frontmatter, which an application need not declare, so whatever is there is read as a list
    // of strings only when it is one
    private static resolveKeywords(page: DocsPage): string[] {
        const frontmatter: object = page.module.frontmatter;
        const keywords: unknown = 'keywords' in frontmatter ? frontmatter.keywords : undefined;
        return Array.isArray(keywords) ? keywords.filter(keyword => typeof keyword === 'string') : [];
    }
}