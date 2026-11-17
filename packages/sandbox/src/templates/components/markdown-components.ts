import { MdxComponents } from 'zibri';

import { Blockquote } from './blockquote';
import { CodeBlock } from './code-block';
import { Divider } from './divider';
import { Emphasis } from './emphasis';
import { Heading } from './heading';
import { Image } from './image';
import { InlineCode } from './inline-code';
import { Link } from './link';
import { List } from './list';
import { ListItem } from './list-item';
import { Paragraph } from './paragraph';
import { Strikethrough } from './strikethrough';
import { Strong } from './strong';
import { Table } from './table';
import { TableBody } from './table-body';
import { TableCell } from './table-cell';
import { TableHead } from './table-head';
import { TableRow } from './table-row';

// what each construct of a page written in markdown renders, which src/providers.ts provides
export const markdownComponents: MdxComponents = {
    heading: Heading,
    paragraph: Paragraph,
    link: Link,
    image: Image,
    emphasis: Emphasis,
    strong: Strong,
    delete: Strikethrough,
    inlineCode: InlineCode,
    codeBlock: CodeBlock,
    blockquote: Blockquote,
    list: List,
    listItem: ListItem,
    table: Table,
    tableHead: TableHead,
    tableBody: TableBody,
    tableRow: TableRow,
    tableCell: TableCell,
    thematicBreak: Divider
};