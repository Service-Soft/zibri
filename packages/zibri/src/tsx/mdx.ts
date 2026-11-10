/**
 * What pages written in markdown are rendered with, re-exported so templates import everything from `zibri`. A
 * `.md` or `.mdx` template is compiled by zibri-tsx into a module whose default export is the page.
 */
export { MdxComponentsContext } from 'zibri-tsx';

// eslint-disable-next-line jsdoc/require-jsdoc, stylistic/max-len
export type { MdxAlert, MdxBlockquoteProps, MdxCodeBlockProps, MdxComponent, MdxComponents, MdxContentProps, MdxFrontmatter, MdxHeading, MdxHeadingProps, MdxImageProps, MdxInlineCodeProps, MdxLinkProps, MdxListItemProps, MdxListProps, MdxPage, MdxPageProps, MdxTableCellProps, MdxTableRowProps } from 'zibri-tsx';