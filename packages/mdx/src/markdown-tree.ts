import type { Blockquote, Code, Definition, FootnoteDefinition, Heading, Html, List, ListItem, Nodes, PhrasingContent, Root, RootContent, Table } from 'mdast';
import type { MdxFlowExpression, MdxJsxFlowElement, MdxJsxTextElement, MdxTextExpression } from 'mdast-util-mdx';
import type { MdxAlert, MdxComponents, MdxHeading } from 'zibri-tsx';

import { HighlightedCode, HighlightedToken, HighlightUtilities } from './highlight';

/**
 * A construct a component can be chosen for.
 */
export type ConstructKind = keyof MdxComponents;

/**
 * The props of a construct, in the order they are written: each a value markdown holds.
 */
export type ConstructProps = Record<string, string | number | boolean | undefined>;

/**
 * A markdown construct, which renders the component chosen for it.
 */
export type MarkdownConstruct = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'construct',
    // eslint-disable-next-line jsdoc/require-jsdoc
    kind: ConstructKind,
    // eslint-disable-next-line jsdoc/require-jsdoc
    props: ConstructProps,
    /**
     * Its content. Undefined for a construct that holds none, an image or a thematic break, which the printer writes as
     * an element closing itself.
     */
    children: MarkdownTreeNode[] | undefined,
    /**
     * Where it is in the markdown.
     */
    node: Nodes
};

/**
 * A plain element markdown renders whichever components are chosen, such as the list of footnotes.
 */
export type MarkdownElement = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'element',
    // eslint-disable-next-line jsdoc/require-jsdoc
    tag: string,
    /**
     * Its attributes, each a text.
     */
    attributes: Record<string, string>,
    /**
     * Its content. Undefined for an element closing itself.
     */
    children: MarkdownTreeNode[] | undefined,
    /**
     * Where it is in the markdown, when it stands for a node of it.
     */
    node: Nodes | undefined
};

/**
 * Text, escaped when it renders.
 */
export type MarkdownText = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'text',
    // eslint-disable-next-line jsdoc/require-jsdoc
    value: string,
    /**
     * Where it is in the markdown, when it stands for a node of it.
     */
    node: Nodes | undefined
};

/**
 * The start of a line of a code block, so what follows names the line of the markdown it is on.
 */
export type MarkdownLineStart = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'line',
    /**
     * The line of the markdown, 0-based.
     */
    line: number
};

/**
 * Html in the markdown, which neither a `.md` template nor markdown rendered at runtime holds. A comment is left out
 * instead.
 */
export type MarkdownHtml = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'html',
    // eslint-disable-next-line jsdoc/require-jsdoc
    node: Html
};

/**
 * A `{}` expression of an `.mdx` file.
 */
export type MarkdownExpression = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'expression',
    // eslint-disable-next-line jsdoc/require-jsdoc
    node: MdxFlowExpression | MdxTextExpression
};

/**
 * A JSX element of an `.mdx` file, with its content.
 */
export type MarkdownJsxElement = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    type: 'jsx',
    // eslint-disable-next-line jsdoc/require-jsdoc
    node: MdxJsxFlowElement | MdxJsxTextElement,
    // eslint-disable-next-line jsdoc/require-jsdoc
    children: MarkdownTreeNode[]
};

/**
 * What markdown renders, before it is printed as a template or rendered at runtime.
 */
export type MarkdownTreeNode = MarkdownConstruct | MarkdownElement | MarkdownText | MarkdownLineStart | MarkdownHtml
    | MarkdownExpression | MarkdownJsxElement;

/**
 * Markdown as what it renders.
 */
export type MarkdownTree = {
    /**
     * What it renders, the list of its footnotes last.
     */
    nodes: MarkdownTreeNode[],
    /**
     * The code blocks naming a language the highlighter does not know, whose code is not highlighted.
     */
    unknownLanguages: Code[],
    /**
     * Its headings in order, each whose text is written out.
     */
    headings: MdxHeading[]
};

/**
 * The kinds of alert, in the order GitHub lists them.
 */
const ALERT_KINDS: MdxAlert[] = ['note', 'tip', 'important', 'warning', 'caution'];

/**
 * The first line of a blockquote that is an alert, `[!WARNING]` alone on it, as GitHub reads it.
 */
const ALERT_MARKER: RegExp = /^\[!([A-Z]+)\][ \t]*(?:\n|$)/;

/**
 * What a blockquote that is an alert is titled with when it renders as its plain element.
 */
export const ALERT_TITLES: Record<MdxAlert, string> = {
    note: 'Note',
    tip: 'Tip',
    important: 'Important',
    warning: 'Warning',
    caution: 'Caution'
};

/**
 * Languages a code block names to say its code is plain text, which is left as it is.
 */
const PLAIN_LANGUAGES: ReadonlySet<string> = new Set(['text', 'txt', 'plain', 'plaintext']);

/**
 * Turns parsed markdown into what it renders: once, for the build that prints it as a template and for the runtime that
 * renders it, so the two render the same.
 */
export abstract class MarkdownTreeUtilities {
    /**
     * Resolves what parsed markdown renders: each construct with its props, the anchors of its headings, its references
     * resolved, its code highlighted, and its footnotes listed at its end.
     * @param root - The parsed markdown.
     * @returns What it renders.
     */
    static resolveMarkdownTree(root: Root): MarkdownTree {
        return new MarkdownTreeBuilder(root).build();
    }
}

/**
 * Builds the tree of one piece of markdown.
 */
class MarkdownTreeBuilder {
    private readonly anchors: Map<string, number> = new Map();
    private readonly definitions: Map<string, Definition> = new Map();
    private readonly footnoteDefinitions: Map<string, FootnoteDefinition> = new Map();
    // the footnotes in the order the markdown first names them, which is the order they are listed in
    private readonly footnotes: string[] = [];
    private readonly unknownLanguages: Code[] = [];
    private readonly headings: MdxHeading[] = [];

    constructor(private readonly root: Root) {}

    /**
     * Builds the tree.
     * @returns What the markdown renders.
     */
    build(): MarkdownTree {
        this.collectDefinitions(this.root);
        const nodes: MarkdownTreeNode[] = this.blocks(this.root.children, false);
        return { nodes: [...nodes, ...this.footnoteList()], unknownLanguages: this.unknownLanguages, headings: this.headings };
    }

    private collectDefinitions(node: Nodes): void {
        if (node.type === 'definition') {
            this.definitions.set(node.identifier, node);
        }
        if (node.type === 'footnoteDefinition') {
            this.footnoteDefinitions.set(node.identifier, node);
        }
        if ('children' in node) {
            for (const child of node.children) {
                this.collectDefinitions(child);
            }
        }
    }

    private blocks(nodes: RootContent[], tight: boolean): MarkdownTreeNode[] {
        return nodes.flatMap(node => this.block(node, tight));
    }

    private block(node: RootContent, tight: boolean): MarkdownTreeNode[] {
        switch (node.type) {
            case 'heading': {
                return [this.heading(node)];
            }
            case 'paragraph': {
                // a list without blank lines between its items holds their text, as GitHub renders it, rather than paragraphs
                return tight
                    ? this.phrasing(node.children)
                    : [construct('paragraph', {}, this.phrasing(node.children), node)];
            }
            case 'blockquote': {
                return [this.blockquote(node)];
            }
            case 'list': {
                return [this.list(node)];
            }
            case 'code': {
                return [this.codeBlock(node)];
            }
            case 'table': {
                return [this.table(node)];
            }
            case 'thematicBreak': {
                return [construct('thematicBreak', {}, undefined, node)];
            }
            case 'html': {
                return html(node);
            }
            case 'mdxFlowExpression': {
                return [{ type: 'expression', node }];
            }
            case 'mdxJsxFlowElement': {
                return [{ type: 'jsx', node, children: this.blocks(node.children, false) }];
            }
            // what renders nothing where it is: printed above the markup, or where it is named
            case 'yaml':
            case 'mdxjsEsm':
            case 'definition':
            case 'footnoteDefinition':
            // only ever inside their list or table, which render them
            case 'listItem':
            case 'tableRow':
            case 'tableCell': {
                return [];
            }
            case 'text':
            case 'emphasis':
            case 'strong':
            case 'delete':
            case 'inlineCode':
            case 'break':
            case 'link':
            case 'image':
            case 'linkReference':
            case 'imageReference':
            case 'footnoteReference':
            case 'mdxTextExpression':
            case 'mdxJsxTextElement': {
                return this.phrasing([node]);
            }
        }
    }

    private heading(node: Heading): MarkdownConstruct {
        const text: string | undefined = findText(node);
        const anchor: string | undefined = text === undefined ? undefined : this.resolveAnchor(text);
        if (text !== undefined && anchor !== undefined) {
            this.headings.push({ depth: node.depth, text, id: anchor });
        }
        return construct('heading', { tag: `h${node.depth}`, id: anchor }, this.phrasing(node.children), node);
    }

    /**
     * The anchor of a heading, the way GitHub derives it: its text in lower case, without punctuation, spaces as
     * dashes, and a number added to the second and each later heading of the same text.
     * @param text - The text of the heading.
     * @returns The anchor.
     */
    private resolveAnchor(text: string): string {
        const anchor: string = text
            .toLowerCase()
            .trim()
            .replaceAll(/[^\p{L}\p{N} _-]/gu, '')
            .replaceAll(' ', '-');
        const seen: number = this.anchors.get(anchor) ?? 0;
        this.anchors.set(anchor, seen + 1);
        return seen === 0 ? anchor : `${anchor}-${seen}`;
    }

    /**
     * A blockquote, which is an alert as GitHub writes it when its first line names one, such as `> [!WARNING]`. That
     * line is left out of its content.
     * @param node - The blockquote.
     * @returns The construct.
     */
    private blockquote(node: Blockquote): MarkdownConstruct {
        const [first, ...rest] = node.children;
        const firstText: PhrasingContent | undefined = first?.type === 'paragraph' ? first.children[0] : undefined;
        const marker: RegExpExecArray | null = firstText?.type === 'text' ? ALERT_MARKER.exec(firstText.value) : null;
        const alert: MdxAlert | undefined = ALERT_KINDS.find(kind => kind.toUpperCase() === marker?.[1]);
        if (first?.type !== 'paragraph' || firstText?.type !== 'text' || marker === null || alert === undefined) {
            return construct('blockquote', {}, this.blocks(node.children, false), node);
        }
        const remainder: string = firstText.value.slice(marker[0].length);
        const content: PhrasingContent[] = remainder === ''
            ? first.children.slice(1)
            : [{ ...firstText, value: remainder }, ...first.children.slice(1)];
        const children: RootContent[] = content.length === 0 ? rest : [{ ...first, children: content }, ...rest];
        return construct('blockquote', { alert }, this.blocks(children, false), node);
    }

    private list(node: List): MarkdownConstruct {
        const start: number | undefined = node.ordered === true && node.start != undefined && node.start !== 1 ? node.start : undefined;
        const items: MarkdownTreeNode[] = node.children.map(item => this.listItem(item, node.spread !== true));
        return construct('list', { ordered: node.ordered === true, start }, items, node);
    }

    private listItem(node: ListItem, tightList: boolean): MarkdownConstruct {
        const checked: boolean | undefined = node.checked ?? undefined;
        return construct('listItem', { checked }, this.blocks(node.children, tightList && node.spread !== true), node);
    }

    private codeBlock(node: Code): MarkdownConstruct {
        const language: string | undefined = node.lang ?? undefined;
        const plain: boolean = language === undefined || PLAIN_LANGUAGES.has(language.toLowerCase());
        const highlighted: HighlightedCode = plain || language === undefined
            ? { lines: undefined }
            : HighlightUtilities.resolveHighlightedCode(node.value, language);
        if (!plain && highlighted.lines === undefined) {
            this.unknownLanguages.push(node);
        }
        const lines: HighlightedToken[][] = highlighted.lines ?? node.value.split('\n').map(text => [{ text }]);
        // the code starts on the line below the opening fence
        const firstLine: number = lineOf(node) + 1;
        const content: MarkdownTreeNode[] = [...lines.entries()].flatMap(([index, tokens]): MarkdownTreeNode[] => [
            { type: 'line', line: firstLine + index },
            ...index === 0 ? [] : [text('\n')],
            ...tokens.map((token): MarkdownTreeNode => token.className === undefined
                ? text(token.text)
                : {
                    type: 'element',
                    tag: 'span',
                    attributes: { className: token.className },
                    children: [text(token.text)],
                    node: undefined
                })
        ]);
        return construct('codeBlock', { language, meta: node.meta ?? undefined, code: node.value }, content, node);
    }

    private table(node: Table): MarkdownConstruct {
        const [head, ...body] = node.children;
        const parts: MarkdownTreeNode[] = [
            ...head === undefined ? [] : [construct('tableHead', {}, [this.tableRow(node, head, true)], head)],
            ...body.length === 0 ? [] : [construct('tableBody', {}, body.map(row => this.tableRow(node, row, false)), body[0] ?? node)]
        ];
        return construct('table', {}, parts, node);
    }

    private tableRow(table: Table, row: Table['children'][number], head: boolean): MarkdownConstruct {
        const cells: MarkdownTreeNode[] = row.children.map((cell, index) => {
            const align: string | undefined = table.align?.[index] ?? undefined;
            return construct('tableCell', { head, align }, this.phrasing(cell.children), cell);
        });
        return construct('tableRow', { head }, cells, row);
    }

    private phrasing(nodes: PhrasingContent[]): MarkdownTreeNode[] {
        return nodes.flatMap((node): MarkdownTreeNode[] => {
            switch (node.type) {
                case 'text': {
                    return [text(node.value, node)];
                }
                case 'emphasis':
                case 'strong':
                case 'delete': {
                    return [construct(node.type, {}, this.phrasing(node.children), node)];
                }
                case 'inlineCode': {
                    return [construct('inlineCode', { code: node.value }, [text(node.value)], node)];
                }
                case 'break': {
                    return [{ type: 'element', tag: 'br', attributes: {}, children: undefined, node }];
                }
                case 'link': {
                    return [this.link(node.url, node.title, node.children, node)];
                }
                case 'image': {
                    return [image(node.url, node.alt, node.title, node)];
                }
                case 'linkReference': {
                    const definition: Definition | undefined = this.definitions.get(node.identifier);
                    return definition === undefined
                        ? this.phrasing(node.children)
                        : [this.link(definition.url, definition.title, node.children, node)];
                }
                case 'imageReference': {
                    const definition: Definition | undefined = this.definitions.get(node.identifier);
                    return definition === undefined
                        ? [text(node.alt ?? '', node)]
                        : [image(definition.url, node.alt, definition.title, node)];
                }
                case 'footnoteReference': {
                    return [this.footnoteReference(node.identifier, node)];
                }
                case 'html': {
                    return html(node);
                }
                case 'mdxTextExpression': {
                    return [{ type: 'expression', node }];
                }
                case 'mdxJsxTextElement': {
                    return [{ type: 'jsx', node, children: this.phrasing(node.children) }];
                }
            }
        });
    }

    private link(url: string, title: string | null | undefined, children: PhrasingContent[], node: Nodes): MarkdownConstruct {
        return construct('link', { href: url, title: title ?? undefined }, this.phrasing(children), node);
    }

    private footnoteReference(identifier: string, node: Nodes): MarkdownTreeNode {
        if (!this.footnoteDefinitions.has(identifier)) {
            return text(`[^${identifier}]`, node);
        }
        const first: boolean = !this.footnotes.includes(identifier);
        if (first) {
            this.footnotes.push(identifier);
        }
        const id: string = toFootnoteId(identifier);
        const number: number = this.footnotes.indexOf(identifier) + 1;
        const link: MarkdownElement = {
            type: 'element',
            tag: 'a',
            attributes: { href: `#user-content-fn-${id}`, ...first ? { id: `user-content-fnref-${id}` } : {} },
            children: [text(String(number))],
            node: undefined
        };
        return { type: 'element', tag: 'sup', attributes: {}, children: [link], node };
    }

    /**
     * The footnotes the markdown names, listed at its end, each with a link back to where it is named.
     * @returns The list, or nothing when the markdown names no footnote.
     */
    private footnoteList(): MarkdownTreeNode[] {
        if (this.footnotes.length === 0) {
            return [];
        }
        const items: MarkdownTreeNode[] = [];
        // a footnote can name one the markdown did not, which is pushed while this loop runs and listed after it: an
        // array's iterator reads the length on every step, so it reaches that one as well
        for (const identifier of this.footnotes) {
            const definition: FootnoteDefinition | undefined = this.footnoteDefinitions.get(identifier);
            if (definition === undefined) {
                continue;
            }
            const id: string = toFootnoteId(identifier);
            const back: MarkdownElement = {
                type: 'element',
                tag: 'a',
                attributes: { href: `#user-content-fnref-${id}` },
                children: [text('↩')],
                node: undefined
            };
            items.push({
                type: 'element',
                tag: 'li',
                attributes: { id: `user-content-fn-${id}` },
                children: [...this.blocks(definition.children, false), back],
                node: definition
            });
        }
        const list: MarkdownElement = { type: 'element', tag: 'ol', attributes: {}, children: items, node: undefined };
        return [{ type: 'element', tag: 'section', attributes: { className: 'footnotes' }, children: [list], node: undefined }];
    }
}

/**
 * A construct.
 * @param kind - Which.
 * @param props - Its props.
 * @param children - Its content, or undefined for one holding none.
 * @param node - Where it is in the markdown.
 * @returns The construct.
 */
function construct(kind: ConstructKind, props: ConstructProps, children: MarkdownTreeNode[] | undefined, node: Nodes): MarkdownConstruct {
    return { type: 'construct', kind, props, children, node };
}

/**
 * An image.
 * @param url - Where the image is.
 * @param alt - Its text.
 * @param title - Its title.
 * @param node - Where it is in the markdown.
 * @returns The construct.
 */
function image(url: string, alt: string | null | undefined, title: string | null | undefined, node: Nodes): MarkdownConstruct {
    return construct('image', { src: url, alt: alt ?? '', title: title ?? undefined }, undefined, node);
}

/**
 * Text.
 * @param value - The text.
 * @param node - Where it is in the markdown, when it stands for a node of it.
 * @returns The text.
 */
function text(value: string, node?: Nodes): MarkdownText {
    return { type: 'text', value, node };
}

/**
 * Html in the markdown, or nothing for a comment, which is no markup.
 * @param node - The html.
 * @returns The html, or nothing.
 */
function html(node: Html): MarkdownTreeNode[] {
    return /^<!--[\s\S]*-->$/.test(node.value.trim()) ? [] : [{ type: 'html', node }];
}

/**
 * The line of the markdown a node starts on.
 * @param node - The node.
 * @returns The line, 0-based.
 */
export function lineOf(node: Nodes): number {
    return (node.position?.start.line ?? 1) - 1;
}

/**
 * The text of a node, as a reader sees it.
 * @param node - The node.
 * @returns The text of it and everything in it, or undefined when an expression computes some of it.
 */
function findText(node: Nodes): string | undefined {
    if (node.type === 'text' || node.type === 'inlineCode') {
        return node.value;
    }
    if (node.type === 'mdxTextExpression' || node.type === 'mdxFlowExpression') {
        return undefined;
    }
    if (!('children' in node)) {
        return '';
    }
    const parts: (string | undefined)[] = node.children.map(child => findText(child));
    return parts.includes(undefined) ? undefined : parts.join('');
}

/**
 * The id a footnote is listed under.
 * @param identifier - The footnote's label, as the markdown names it.
 * @returns The id, a part of the list's element ids.
 */
function toFootnoteId(identifier: string): string {
    return identifier.toLowerCase().replaceAll(/[^\p{L}\p{N}_-]/gu, '-');
}