import { describe, expect, it } from '@jest/globals';
import { MdxPage } from 'zibri-tsx';

import { DocsPage, DocsSite } from './docs-site.model';
import { DocsUtilities } from './docs.utilities';
import { compileMarkdownModule } from '../../__testing__/compile-tsx-template.function';

const gettingStarted: DocsPage = {
    file: 'getting-started.md',
    module: compileMarkdownModule<MdxPage>([
        '---',
        'keywords: [setup, install]',
        '---',
        '# Getting started',
        '## Installing it',
        '### On a server',
        '#### Behind a proxy'
    ].join('\n\n'))
};

const writingAPage: DocsPage = {
    file: 'guides/writing-a-page.md',
    module: compileMarkdownModule<MdxPage>('# Writing a page\n\n## Linking another page')
};

const untitled: DocsPage = {
    file: 'guides/untitled.md',
    module: compileMarkdownModule<MdxPage>('Text without a heading.')
};

const site: DocsSite = {
    basePath: '/docs',
    homePage: 'getting-started.md',
    title: 'Task tracker',
    navigation: [gettingStarted, { title: 'Guides', pages: [writingAPage, untitled] }]
};

describe('DocsUtilities', () => {
    it('lists the pages in the order of the navigation', () => {
        expect(DocsUtilities.resolvePages(site)).toEqual([gettingStarted, writingAPage, untitled]);
    });

    it('serves a page at the address its file gives it, the home page at the base path', () => {
        expect(DocsUtilities.resolveAddress(site, 'getting-started.md')).toBe('/docs/');
        expect(DocsUtilities.resolveAddress(site, 'guides/writing-a-page.md')).toBe('/docs/guides/writing-a-page/');
    });

    it('finds a page at its address, with or without the slash at its end', () => {
        expect(DocsUtilities.findPageAt(site, '/docs/')).toBe(gettingStarted);
        expect(DocsUtilities.findPageAt(site, '/docs/guides/writing-a-page')).toBe(writingAPage);
        expect(DocsUtilities.findPageAt(site, '/docs/guides/missing/')).toBeUndefined();
    });

    it('leads a link to a page file to the address of the page, and leaves any other link as it is', () => {
        expect(DocsUtilities.resolveLink(site, '../getting-started.md#installing-it', 'guides/writing-a-page.md'))
            .toBe('/docs/#installing-it');
        expect(DocsUtilities.resolveLink(site, './untitled.md', 'guides/writing-a-page.md')).toBe('/docs/guides/untitled/');
        expect(DocsUtilities.resolveLink(site, 'https://example.com/tasks', 'getting-started.md')).toBe('https://example.com/tasks');
        expect(DocsUtilities.resolveLink(site, '#installing-it', 'getting-started.md')).toBe('#installing-it');
    });

    it('titles a page by its first heading, or by its file without one', () => {
        expect(DocsUtilities.resolveTitle(writingAPage)).toBe('Writing a page');
        expect(DocsUtilities.resolveTitle(untitled)).toBe('guides/untitled.md');
    });

    it('lists every page and every section of one for the search, a page with its keywords', () => {
        expect(DocsUtilities.resolveSearchEntries(site)).toEqual([
            { title: 'Getting started', address: '/docs/', context: 'Task tracker', keywords: ['setup', 'install'] },
            { title: 'Installing it', address: '/docs/#installing-it', context: 'Getting started', keywords: [] },
            { title: 'On a server', address: '/docs/#on-a-server', context: 'Getting started', keywords: [] },
            { title: 'Writing a page', address: '/docs/guides/writing-a-page/', context: 'Guides', keywords: [] },
            {
                title: 'Linking another page',
                address: '/docs/guides/writing-a-page/#linking-another-page',
                context: 'Writing a page',
                keywords: []
            },
            { title: 'guides/untitled.md', address: '/docs/guides/untitled/', context: 'Guides', keywords: [] }
        ]);
    });

    it('serves the index of the search below the base path, where no page is', () => {
        expect(DocsUtilities.resolveSearchIndexAddress(site)).toBe('/docs/search/v1/index.json');
    });
});