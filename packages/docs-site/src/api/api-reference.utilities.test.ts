// cspell:ignore resolvepage -- the anchor of a member, its name in lowercase
import { describe, expect, it } from '@jest/globals';

import { ApiReferenceUtilities } from './api-reference.utilities';

describe('the export code names', () => {
    it('is the export a code span names, with its kind', () => {
        expect(ApiReferenceUtilities.findCodeTarget('MarkdownService')).toEqual({ address: '/zibri/api/MarkdownService/', kind: 'class' });
        expect(ApiReferenceUtilities.findCodeTarget('Passkey')?.kind).toBe('entity');
    });

    it('is the member a code span names, under its anchor in lowercase as typedoc gave it, called or used as a decorator', () => {
        expect(ApiReferenceUtilities.findCodeTarget('ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS')?.address).toBe('/zibri/api/ZIBRI_DI_TOKENS/#markdown_options');
        expect(ApiReferenceUtilities.findCodeTarget('@Auth.skip()')?.address).toBe('/zibri/api/Auth/#skip');
        expect(ApiReferenceUtilities.findCodeTarget('MarkdownService.resolvePage(source)')?.address).toBe('/zibri/api/MarkdownService/#resolvepage');
    });

    it('is the page of the export for a member it does not have', () => {
        expect(ApiReferenceUtilities.findCodeTarget('MarkdownService.nothing')?.address).toBe('/zibri/api/MarkdownService/');
    });

    it('is nothing for code naming nothing zibri exports, or more than a name', () => {
        expect(ApiReferenceUtilities.findCodeTarget('Date.now()')).toBeUndefined();
        expect(ApiReferenceUtilities.findCodeTarget('options.headers')).toBeUndefined();
        expect(ApiReferenceUtilities.findCodeTarget('new MarkdownService()')).toBeUndefined();
        expect(ApiReferenceUtilities.findCodeTarget('npm run build')).toBeUndefined();
    });
});