import { describe, expect, it } from '@jest/globals';
import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };

import { ApiCommentUtilities } from './api-comment.utilities';
import { ApiExport } from './api-export.model';
import { ApiReferenceUtilities } from './api-reference.utilities';

/**
 * The id typedoc gives the declaration of an export.
 * @param name - The name of the export.
 * @returns The id.
 * @throws When zibri exports no such name.
 */
function resolveIdOf(name: string): JSONOutput.ReflectionId {
    const apiExport: ApiExport | undefined = ApiReferenceUtilities.findExport(name);
    const [declaration] = apiExport?.declarations ?? [];
    if (declaration == undefined) {
        throw new Error(`zibri exports no ${name}.`);
    }
    return declaration.id;
}

describe('the markdown of a comment', () => {
    it('keeps text and code as written, and links an export it links to its page', () => {
        const markdown: string = ApiCommentUtilities.resolveSummaryMarkdown({
            summary: [
                { kind: 'text', text: 'Renders through ' },
                { kind: 'inline-tag', tag: '@link', text: 'MarkdownService', target: resolveIdOf('MarkdownService') },
                { kind: 'text', text: ', with ' },
                { kind: 'code', text: '`renderAtRuntime`' },
                { kind: 'text', text: ' set.' }
            ]
        });

        expect(markdown).toBe('Renders through [`MarkdownService`](/zibri/api/MarkdownService/), with `renderAtRuntime` set.');
    });

    it('warns before the summary of what is deprecated, with the reason', () => {
        const markdown: string = ApiCommentUtilities.resolveSummaryMarkdown({
            summary: [{ kind: 'text', text: 'The old way.' }],
            blockTags: [{ tag: '@deprecated', content: [{ kind: 'text', text: 'Use the new way.' }] }]
        });

        expect(markdown).toBe('> [!CAUTION]\n> Deprecated. Use the new way.\n\nThe old way.');
    });

    it('puts the block tags under their titles, what it returns before what it throws', () => {
        const markdown: string = ApiCommentUtilities.resolveBlockTagsMarkdown({
            summary: [],
            blockTags: [
                { tag: '@throws', content: [{ kind: 'text', text: 'When it is missing.' }] },
                { tag: '@returns', content: [{ kind: 'text', text: 'The value.' }] }
            ]
        });

        expect(markdown).toBe('**Returns**\n\nThe value.\n\n**Throws**\n\nWhen it is missing.');
    });

    it('takes the first sentence of a summary as text, for the index', () => {
        expect(ApiCommentUtilities.resolveFirstSentence({
            summary: [{ kind: 'code', text: '`Markdown`' }, { kind: 'text', text: ' renders it. Then more follows.' }]
        })).toBe('Markdown renders it.');
    });
});