import { MdxComponents } from 'zibri';

import { DocsHeading } from './docs-heading';
import { DocsLink } from './docs-link';
import { markdownComponents } from '../components/markdown-components';

// what the pages of the documentation render: what every page written in markdown renders, with headings and links of
// their own
export const docsMarkdownComponents: MdxComponents = {
    ...markdownComponents,
    heading: DocsHeading,
    link: DocsLink
};