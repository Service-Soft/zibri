import { TsxChildren, TsxElement } from '../jsx/jsx.model';
import { createContext, RenderContext } from '../runtime/server-runtime';

/**
 * A component a markdown construct renders, taking the props of that construct.
 */
export type MdxComponent<P> = (props: P) => TsxElement;

/**
 * The props of a construct that holds nothing but its content, such as a paragraph.
 */
export type MdxContentProps = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    children: TsxChildren
};

/**
 * The props of a heading: `#` is `h1`, `######` is `h6`.
 */
export type MdxHeadingProps = MdxContentProps & {
    /**
     * The element of its level.
     */
    tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
    /**
     * The anchor a link to it names, derived from its text the way GitHub derives it. Undefined for a heading of an
     * mdx file whose text an expression computes, as that text is only known once it renders.
     */
    id?: string
};

/**
 * The props of a link.
 */
export type MdxLinkProps = MdxContentProps & {
    /**
     * Where it leads.
     */
    href: string,
    /**
     * Its title, written in quotes after the address.
     */
    title?: string
};

/**
 * The props of an image.
 */
export type MdxImageProps = {
    /**
     * Where the image is.
     */
    src: string,
    /**
     * Its text, for whoever cannot see it.
     */
    alt: string,
    /**
     * Its title, written in quotes after the address.
     */
    title?: string
};

/**
 * The props of a span of code in the text, written between backticks.
 */
export type MdxInlineCodeProps = MdxContentProps & {
    /**
     * The code as written, such as for a link to what it names.
     */
    code: string
};

/**
 * The props of a fenced code block. Its content is the code, highlighted: one `span` per token, with the class of its
 * kind, such as `shiki-token-keyword`.
 */
export type MdxCodeBlockProps = MdxContentProps & {
    /**
     * The language named after the opening fence, such as `ts`.
     */
    language?: string,
    /**
     * What follows the language on the opening fence.
     */
    meta?: string,
    /**
     * The code as written, such as for a button that copies it.
     */
    code: string
};

/**
 * The kind of an alert, as GitHub writes it: a blockquote whose first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]`.
 */
export type MdxAlert = 'note' | 'tip' | 'important' | 'warning' | 'caution';

/**
 * The props of a blockquote.
 */
export type MdxBlockquoteProps = MdxContentProps & {
    /**
     * The kind of alert it is, which its first line names, such as `> [!WARNING]`. That line is not part of its
     * content. Undefined for a blockquote that is no alert.
     */
    alert?: MdxAlert
};

/**
 * The props of a list.
 */
export type MdxListProps = MdxContentProps & {
    /**
     * Whether it is numbered.
     */
    ordered: boolean,
    /**
     * The number a numbered list starts at, when it is not 1.
     */
    start?: number
};

/**
 * The props of an item of a list.
 */
export type MdxListItemProps = MdxContentProps & {
    /**
     * Whether the task it is is done: `- [x]` is, `- [ ]` is not. Undefined for an item that is no task.
     */
    checked?: boolean
};

/**
 * The props of a row of a table.
 */
export type MdxTableRowProps = MdxContentProps & {
    /**
     * Whether it is the row of the column titles.
     */
    head: boolean
};

/**
 * The props of a cell of a table.
 */
export type MdxTableCellProps = MdxContentProps & {
    /**
     * Whether it is the title of its column.
     */
    head: boolean,
    /**
     * How its column is aligned, which the line below the titles says.
     */
    align?: 'left' | 'right' | 'center'
};

/**
 * The components the markdown constructs of a page render. A construct without one renders as its plain element.
 */
export type MdxComponents = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    heading?: MdxComponent<MdxHeadingProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    paragraph?: MdxComponent<MdxContentProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    link?: MdxComponent<MdxLinkProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    image?: MdxComponent<MdxImageProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    emphasis?: MdxComponent<MdxContentProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    strong?: MdxComponent<MdxContentProps>,
    /**
     * Struck through text, written as `~~text~~`.
     */
    delete?: MdxComponent<MdxContentProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    inlineCode?: MdxComponent<MdxInlineCodeProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    codeBlock?: MdxComponent<MdxCodeBlockProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    blockquote?: MdxComponent<MdxBlockquoteProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    list?: MdxComponent<MdxListProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    listItem?: MdxComponent<MdxListItemProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    table?: MdxComponent<MdxContentProps>,
    /**
     * The part of a table holding the row of column titles.
     */
    tableHead?: MdxComponent<MdxContentProps>,
    /**
     * The part of a table holding the rows below the column titles.
     */
    tableBody?: MdxComponent<MdxContentProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    tableRow?: MdxComponent<MdxTableRowProps>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    tableCell?: MdxComponent<MdxTableCellProps>,
    /**
     * A line across, written as `---`.
     */
    thematicBreak?: MdxComponent<{}>
};

/**
 * The props of a page written in markdown.
 */
export type MdxPageProps = {
    /**
     * The components its constructs render, over the ones of {@link MdxComponentsContext}.
     */
    components?: MdxComponents
};

/**
 * A page written in markdown, the default export of a `.md` or `.mdx` file.
 */
export type MdxPage = MdxComponent<MdxPageProps>;

/**
 * The frontmatter of a page, the block between the `---` lines its file starts with. Empty until an application
 * declares what a page has there, which the build then checks every page for:.
 * ```ts
 * declare module 'zibri-tsx' {
 *     interface MdxFrontmatter {
 *         title: string,
 *         description?: string
 *     }
 * }
 * ```
 */
// an interface, as an application declares its fields by merging into it

export interface MdxFrontmatter {}

/**
 * A heading of a page, as the export `headings` of a `.md` or `.mdx` file lists them, such as for a table of contents.
 * A heading of an mdx file whose text an expression computes has no anchor, and is not listed.
 */
export type MdxHeading = {
    /**
     * Its level: 1 for `#`, 6 for `######`.
     */
    depth: 1 | 2 | 3 | 4 | 5 | 6,
    /**
     * Its text, without the markup in it.
     */
    text: string,
    /**
     * The anchor it renders with, the `id` of `MdxHeadingProps`.
     */
    id: string
};

/**
 * The components the pages written in markdown render, for every page a component provides it to. A page's
 * `components` prop goes over it.
 */
export const MdxComponentsContext: RenderContext<MdxComponents> = createContext<MdxComponents>({});