import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { DocsUtilities } from 'zibri';

import { DOCS_SITE } from './docs-site';

const DOCS_DIR: string = path.join(__dirname, '..', '..', '..', 'zibri', 'docs');

/**
 * Every page of the documentation, as its file below the docs.
 * @returns The files, with `/` between folders.
 */
function resolveDocsFiles(): string[] {
    return readdirSync(DOCS_DIR, { recursive: true, encoding: 'utf8' })
        .map(name => name.split(path.sep).join('/'))
        .filter(name => name.endsWith('.md') && !name.startsWith('.generated/'));
}

describe('the navigation', () => {
    it('lists every page of the documentation once, and nothing else', () => {
        const listed: string[] = DocsUtilities.resolvePages(DOCS_SITE).map(page => page.file);

        expect(new Set(listed).size).toBe(listed.length);
        expect([...listed].sort()).toEqual(resolveDocsFiles().sort());
    });

    it('names every page by its first heading', () => {
        const untitled: string[] = DocsUtilities.resolvePages(DOCS_SITE)
            .filter(page => page.module.headings[0]?.depth !== 1)
            .map(page => page.file);

        expect(untitled).toEqual([]);
    });
});