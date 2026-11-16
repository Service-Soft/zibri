import { describe, expect, it } from '@jest/globals';
import { DocsUtilities } from 'zibri';

import { DOCS_SITE } from './docs-site';
import { ImageUtilities } from './image.utilities';

describe('the addresses of the site', () => {
    it('gives a page the address of its file, and the first page the address of the site', () => {
        expect(DocsUtilities.resolveAddress(DOCS_SITE, 'auth/passkeys.md')).toBe('/zibri/auth/passkeys/');
        expect(DocsUtilities.resolveAddress(DOCS_SITE, 'faq.md')).toBe('/zibri/faq/');
        expect(DocsUtilities.resolveAddress(DOCS_SITE, 'getting-started.md')).toBe('/zibri/');
    });

    it('leads a link naming another page by its file to the address of that page, with its anchor', () => {
        expect(DocsUtilities.resolveLink(DOCS_SITE, '../auth/auth.md#logging-in', 'data/models.md')).toBe('/zibri/auth/auth/#logging-in');
        expect(DocsUtilities.resolveLink(DOCS_SITE, './application/di.md#configuration', 'getting-started.md'))
            .toBe('/zibri/application/di/#configuration');
        expect(DocsUtilities.resolveLink(DOCS_SITE, '../getting-started.md', 'auth/auth.md')).toBe('/zibri/');
    });

    it('leads an image beside its page to the images of the site', () => {
        expect(ImageUtilities.resolveImage('./assets-explorer.png', 'endpoints/assets.md'))
            .toBe('/zibri/images/endpoints/assets-explorer.png');
        expect(ImageUtilities.resolveImage('https://example.com/logo.png', 'endpoints/assets.md')).toBe('https://example.com/logo.png');
    });

    it('finds a page at its address, with or without the slash at the end', () => {
        expect(DocsUtilities.findPageAt(DOCS_SITE, '/zibri/auth/passkeys/')?.file).toBe('auth/passkeys.md');
        expect(DocsUtilities.findPageAt(DOCS_SITE, '/zibri/auth/passkeys')?.file).toBe('auth/passkeys.md');
        expect(DocsUtilities.findPageAt(DOCS_SITE, '/zibri/getting-started/')).toBeUndefined();
    });
});