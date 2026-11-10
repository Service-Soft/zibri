import type { JSONOutput } from 'typedoc' with { 'resolution-mode': 'import' };

import { ApiReferenceUtilities } from './api-reference.utilities';

// the block tags a comment shows below its summary, in this order, each under its title
const BLOCK_TAG_TITLES: [string, string][] = [
    ['@returns', 'Returns'],
    ['@yields', 'Yields'],
    ['@throws', 'Throws'],
    ['@default', 'Default'],
    ['@see', 'See'],
    ['@example', 'Example']
];

/**
 * Turns the JSDoc of an export, as typedoc reads it, into markdown.
 */
export abstract class ApiCommentUtilities {
    /**
     * The markdown of the summary of a comment, after a warning when it is deprecated.
     * @param comment - The comment.
     * @returns The markdown, empty for no comment.
     */
    static resolveSummaryMarkdown(comment: JSONOutput.Comment | undefined): string {
        const deprecated: JSONOutput.CommentTag | undefined = comment?.blockTags?.find(tag => tag.tag === '@deprecated');
        return [
            ...deprecated == undefined ? [] : [this.resolveDeprecation(deprecated)],
            this.resolvePartsMarkdown(comment?.summary ?? [])
        ].filter(part => part !== '').join('\n\n');
    }

    /**
     * The markdown of the block tags of a comment, such as what a function returns, each under its title.
     * @param comment - The comment.
     * @returns The markdown, empty for none.
     */
    static resolveBlockTagsMarkdown(comment: JSONOutput.Comment | undefined): string {
        return BLOCK_TAG_TITLES.flatMap(([tag, title]) => (comment?.blockTags ?? [])
            .filter(blockTag => blockTag.tag === tag)
            .map(blockTag => `**${title}**\n\n${this.resolvePartsMarkdown(blockTag.content)}`))
            .join('\n\n');
    }

    /**
     * The first sentence of the summary of a comment, as text.
     * @param comment - The comment.
     * @returns The sentence, empty for no comment.
     */
    static resolveFirstSentence(comment: JSONOutput.Comment | undefined): string {
        const text: string = (comment?.summary ?? [])
            .map(part => part.kind === 'code' ? part.text.replaceAll('`', '') : part.text)
            .join('');
        return /^[\s\S]*?[.!?](?=\s|$)/.exec(text)?.[0].replaceAll(/\s+/g, ' ').trim() ?? text.trim();
    }

    /**
     * The markdown of parts of a comment: text and code as written, and a link to an export as a link to its page.
     * @param parts - The parts.
     * @returns The markdown.
     */
    static resolvePartsMarkdown(parts: JSONOutput.CommentDisplayPart[]): string {
        return parts.map(part => {
            if (part.kind !== 'inline-tag') {
                return part.text;
            }
            const address: string | undefined = typeof part.target === 'number'
                ? ApiReferenceUtilities.findAddressOf(part.target)
                : undefined;
            return address == undefined ? `\`${part.text}\`` : `[\`${part.text}\`](${address})`;
        }).join('')
            .trim();
    }

    private static resolveDeprecation(tag: JSONOutput.CommentTag): string {
        const reason: string = this.resolvePartsMarkdown(tag.content).replaceAll('\n', '\n> ');
        return ['> [!CAUTION]', reason === '' ? '> Deprecated.' : `> Deprecated. ${reason}`].join('\n');
    }
}