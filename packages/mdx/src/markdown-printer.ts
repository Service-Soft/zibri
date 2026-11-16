import type { Nodes, Root, RootContent, Yaml } from 'mdast';
import type { Document, ParsedNode } from 'yaml';
import { Diagnostic, DiagnosticSeverity, MdxHeading } from 'zibri-tsx';

import { MarkdownPackages, MarkdownPackageUtilities } from './markdown-packages';
import { EmittedLines, LineOrigin, MarkdownDiagnosticCode, MarkdownKind, PrintedMarkdown } from './markdown-printer.model';
import { ALERT_TITLES, ConstructKind, ConstructProps, lineOf, MarkdownJsxElement, MarkdownTree, MarkdownTreeNode, MarkdownTreeUtilities } from './markdown-tree';

/**
 * The plain element each construct renders when no component is chosen for it, as the function declaring it. Markdown
 * rendered at runtime renders the same elements, see `markdown-renderer.ts`.
 */
const DEFAULT_COMPONENTS: Record<ConstructKind, string> = {
    heading: '({ tag, id, children }: Mdx$HeadingProps) { const Tag = tag; return <Tag id={id}>{children}</Tag>; }',
    paragraph: '({ children }: Mdx$ContentProps) { return <p>{children}</p>; }',
    link: '({ href, title, children }: Mdx$LinkProps) { return <a href={href} title={title}>{children}</a>; }',
    image: '({ src, alt, title }: Mdx$ImageProps) { return <img src={src} alt={alt} title={title}/>; }',
    emphasis: '({ children }: Mdx$ContentProps) { return <em>{children}</em>; }',
    strong: '({ children }: Mdx$ContentProps) { return <strong>{children}</strong>; }',
    delete: '({ children }: Mdx$ContentProps) { return <del>{children}</del>; }',
    inlineCode: '({ children }: Mdx$InlineCodeProps) { return <code>{children}</code>; }',
    codeBlock: '({ language, children }: Mdx$CodeBlockProps) { '
        + 'return <pre><code className={language === undefined ? undefined : `language-${language}`}>{children}</code></pre>; }',
    blockquote: '({ alert, children }: Mdx$BlockquoteProps) { return <blockquote>'
        + `{alert !== undefined && <p><strong>{(${JSON.stringify(ALERT_TITLES)})[alert]}</strong></p>}{children}</blockquote>; }`,
    list: '({ ordered, start, children }: Mdx$ListProps) { return ordered ? <ol start={start}>{children}</ol> : <ul>{children}</ul>; }',
    listItem: '({ checked, children }: Mdx$ListItemProps) { '
        + 'return <li>{checked !== undefined && <input type="checkbox" checked={checked} disabled/>}{children}</li>; }',
    table: '({ children }: Mdx$ContentProps) { return <table>{children}</table>; }',
    tableHead: '({ children }: Mdx$ContentProps) { return <thead>{children}</thead>; }',
    tableBody: '({ children }: Mdx$ContentProps) { return <tbody>{children}</tbody>; }',
    tableRow: '({ children }: Mdx$TableRowProps) { return <tr>{children}</tr>; }',
    tableCell: '({ head, align, children }: Mdx$TableCellProps) { '
        + 'return head ? <th align={align}>{children}</th> : <td align={align}>{children}</td>; }',
    thematicBreak: '() { return <hr/>; }'
};

/**
 * The props of a construct written as a text attribute, `tag="h1"`, rather than an expression.
 */
const TEXT_ATTRIBUTE_PROPS: ReadonlySet<string> = new Set(['tag', 'align', 'alert']);

/**
 * The types of zibri-tsx the printed template names, each under a name of its own so none meets a name of the page.
 */
const TYPE_IMPORTS: string[] = [
    'MdxBlockquoteProps',
    'MdxCodeBlockProps',
    'MdxComponents',
    'MdxContentProps',
    'MdxFrontmatter',
    'MdxHeading',
    'MdxHeadingProps',
    'MdxImageProps',
    'MdxInlineCodeProps',
    'MdxLinkProps',
    'MdxListItemProps',
    'MdxListProps',
    'MdxPageProps',
    'MdxTableCellProps',
    'MdxTableRowProps'
];

/**
 * Prints markdown templates as tsx templates, which the compiler then compiles like any other.
 */
export abstract class MarkdownPrinterUtilities {
    /**
     * Prints a markdown template as a tsx template: a default exported component rendering the markdown, with the
     * components its constructs render chosen while it renders, and the frontmatter as the export `frontmatter`.
     * @param source - The markdown.
     * @param kind - Whether it is plain markdown or mdx.
     * @returns The tsx template, and what printing it found.
     */
    static printMarkdown(source: string, kind: MarkdownKind): PrintedMarkdown {
        const packages: MarkdownPackages = MarkdownPackageUtilities.resolveMarkdownPackages();
        let root: Root;
        try {
            root = MarkdownPackageUtilities.parseMarkdown(packages, source, kind);
        }
        catch (error) {
            return { template: undefined, diagnostics: [toSyntaxDiagnostic(error, source)] };
        }
        return new MarkdownPrinter(source, kind, packages).print(root);
    }
}

/**
 * Prints one markdown template.
 */
class MarkdownPrinter {
    private readonly lines: string[] = [];
    private readonly origins: LineOrigin[] = [];
    private readonly diagnostics: Diagnostic[] = [];
    private readonly used: Set<ConstructKind> = new Set();

    constructor(private readonly source: string, private readonly kind: MarkdownKind, private readonly packages: MarkdownPackages) {}

    /**
     * Prints the template.
     * @param root - The parsed markdown.
     * @returns The template, and what printing it found.
     */
    print(root: Root): PrintedMarkdown {
        const tree: MarkdownTree = MarkdownTreeUtilities.resolveMarkdownTree(root);
        for (const code of tree.unknownLanguages) {
            this.report(
                `The language '${code.lang ?? ''}' is not one the highlighter knows, so this code is not highlighted.`,
                code,
                DiagnosticSeverity.WARNING
            );
        }
        this.startLine(0);
        this.printNodes(tree.nodes);
        const frontmatter: EmittedLines | undefined = this.printFrontmatter(root.children.find(node => node.type === 'yaml'));
        if (frontmatter === undefined || this.diagnostics.some(diagnostic => diagnostic.severity === DiagnosticSeverity.ERROR)) {
            return { template: undefined, diagnostics: this.diagnostics };
        }
        const header: EmittedLines = this.printHeader(root, frontmatter, tree.headings);
        const footer: string[] = ['    </>);', '}'];
        const footerOrigin: LineOrigin = this.origins.at(-1) ?? { line: 0, column: 0, exact: false };
        return {
            template: {
                lines: [...header.lines, ...this.lines, ...footer],
                origins: [...header.origins, ...this.origins, ...footer.map(() => footerOrigin)]
            },
            diagnostics: this.diagnostics
        };
    }

    /**
     * Everything above the markup: the page's own imports and exports, those of zibri-tsx, the frontmatter, the
     * headings, the plain elements of the constructs it uses, and the component up to its markup.
     * @param root - The parsed markdown.
     * @param frontmatter - The printed frontmatter.
     * @param headings - The headings of the page, printed as the export `headings`.
     * @returns The lines.
     */
    private printHeader(root: Root, frontmatter: EmittedLines, headings: MdxHeading[]): EmittedLines {
        const lines: string[] = [];
        const origins: LineOrigin[] = [];
        const add: (text: string, line: number) => void = (text, line) => {
            for (const [index, part] of text.split('\n').entries()) {
                lines.push(part);
                origins.push({ line: line + index, column: 0, exact: false });
            }
        };
        for (const node of root.children) {
            if (node.type === 'mdxjsEsm') {
                add(node.value, lineOf(node));
            }
        }
        add('import { MdxComponentsContext, useContext } from \'zibri-tsx\';', 0);
        const typeImports: string = TYPE_IMPORTS.map(name => `${name} as ${toLocalName(name)}`).join(', ');
        add(`import type { ${typeImports} } from 'zibri-tsx';`, 0);
        lines.push(...frontmatter.lines);
        origins.push(...frontmatter.origins);
        add(`export const headings: Mdx$Heading[] = ${JSON.stringify(headings)};`, 0);
        for (const kind of this.used) {
            add(`function MdxDefault$${toPascalCase(kind)}${DEFAULT_COMPONENTS[kind]}`, 0);
        }
        add('export default function MdxPage(props: Mdx$PageProps) {', 0);
        add('    const Mdx$components: Mdx$Components = { ...useContext(MdxComponentsContext), ...props.components };', 0);
        for (const kind of this.used) {
            add(`    const Mdx$${toPascalCase(kind)} = Mdx$components.${kind} ?? MdxDefault$${toPascalCase(kind)};`, 0);
        }
        // the markup is one statement, which a source map leads to the line it starts on: the first of the page's markup
        const markup: RootContent | undefined = root.children.find(node => !['yaml', 'mdxjsEsm', 'definition'].includes(node.type));
        add('    return (<>', markup === undefined ? 0 : lineOf(markup));
        return { lines, origins };
    }

    /**
     * The frontmatter, as the export `frontmatter`: each field on a line of its own, which leads to the line of the
     * markdown it is on, so the type check names that line.
     * @param node - The frontmatter, when the page has any.
     * @returns The lines, or undefined when it is no yaml mapping.
     */
    private printFrontmatter(node: RootContent | undefined): EmittedLines | undefined {
        const close: string = '} satisfies Mdx$Frontmatter;';
        if (node?.type !== 'yaml') {
            return {
                lines: ['export const frontmatter = {', close],
                origins: [{ line: 0, column: 0, exact: false }, { line: 0, column: 0, exact: false }]
            };
        }
        const yaml: Yaml = node;
        // the value starts on the line below the opening `---`
        const firstLine: number = lineOf(yaml) + 1;
        const document: Document.Parsed<ParsedNode> = this.packages.yaml.parseDocument(yaml.value);
        const [error] = document.errors;
        if (error !== undefined) {
            this.report(`The frontmatter cannot be read: ${error.message}`, yaml);
            return undefined;
        }
        const contents: ParsedNode | null = document.contents;
        if (contents !== null && !this.packages.yaml.isMap(contents)) {
            this.report('The frontmatter needs to be a mapping of names to values, such as `title: Imprint`.', yaml);
            return undefined;
        }
        const lines: string[] = ['export const frontmatter = {'];
        const origins: LineOrigin[] = [{ line: firstLine, column: 0, exact: false }];
        for (const pair of contents?.items ?? []) {
            const key: unknown = this.packages.yaml.isScalar(pair.key) ? pair.key.value : undefined;
            const value: unknown = this.packages.yaml.isNode(pair.value) ? pair.value.toJS(document) : null;
            const offset: number = this.packages.yaml.isNode(pair.key) ? pair.key.range[0] : 0;
            lines.push(`    ${JSON.stringify(String(key))}: ${JSON.stringify(value) ?? 'undefined'},`);
            origins.push({ line: firstLine + countLines(yaml.value.slice(0, offset)), column: 0, exact: false });
        }
        lines.push(close);
        origins.push({ line: firstLine, column: 0, exact: false });
        return { lines, origins };
    }

    private printNodes(nodes: MarkdownTreeNode[]): void {
        for (const node of nodes) {
            this.printNode(node);
        }
    }

    private printNode(node: MarkdownTreeNode): void {
        switch (node.type) {
            case 'construct': {
                this.moveTo(node.node);
                this.used.add(node.kind);
                const tag: string = `Mdx$${toPascalCase(node.kind)}`;
                const attributes: string = printProps(node.props);
                if (node.children === undefined) {
                    this.append(`<${tag}${attributes}/>`);
                    return;
                }
                this.append(`<${tag}${attributes}>`);
                const opened: string = this.printed();
                this.printNodes(node.children);
                // a construct with no content, such as an empty cell of a table, still hands `children`, which its
                // component takes
                if (this.printed() === opened) {
                    this.append('{null}');
                }
                this.append(`</${tag}>`);
                return;
            }
            case 'element': {
                if (node.node !== undefined) {
                    this.moveTo(node.node);
                }
                const attributes: string = Object.entries(node.attributes)
                    .map(([name, value]) => ` ${name}=${JSON.stringify(value)}`)
                    .join('');
                if (node.children === undefined) {
                    this.append(`<${node.tag}${attributes}/>`);
                    return;
                }
                this.append(`<${node.tag}${attributes}>`);
                this.printNodes(node.children);
                this.append(`</${node.tag}>`);
                return;
            }
            case 'text': {
                if (node.node !== undefined) {
                    this.moveTo(node.node);
                }
                this.append(`{${JSON.stringify(node.value)}}`);
                return;
            }
            case 'line': {
                this.startLine(node.line);
                return;
            }
            case 'html': {
                this.moveTo(node.node);
                this.report(this.kind === 'md'
                    ? 'A .md template holds no html but comments. Write it as markdown, or rename the file to .mdx and write it as JSX.'
                    : 'An .mdx template holds html as JSX.', node.node);
                return;
            }
            case 'expression': {
                this.moveTo(node.node);
                this.append(`{${node.node.value}}`);
                return;
            }
            case 'jsx': {
                this.moveTo(node.node);
                this.printJsxElement(node);
                return;
            }
        }
    }

    private printJsxElement(element: MarkdownJsxElement): void {
        const { node, children } = element;
        const name: string = node.name ?? '';
        const attributes: string = node.attributes.map(attribute => {
            if (attribute.type === 'mdxJsxExpressionAttribute') {
                return ` {${attribute.value}}`;
            }
            if (attribute.value == undefined) {
                return ` ${attribute.name}`;
            }
            return typeof attribute.value === 'string'
                ? ` ${attribute.name}={${JSON.stringify(attribute.value)}}`
                : ` ${attribute.name}={${attribute.value.value}}`;
        }).join('');
        if (node.children.length === 0) {
            this.append(name === '' ? '<></>' : `<${name}${attributes}/>`);
            return;
        }
        this.append(`<${name}${attributes}>`);
        this.printNodes(children);
        this.append(`</${name}>`);
    }

    private report(message: string, node: Nodes, severity: DiagnosticSeverity = DiagnosticSeverity.ERROR): void {
        this.diagnostics.push({
            code: severity === DiagnosticSeverity.ERROR
                ? MarkdownDiagnosticCode.MARKDOWN_INVALID
                : MarkdownDiagnosticCode.CODE_LANGUAGE_UNKNOWN,
            message,
            severity,
            span: { start: node.position?.start.offset ?? 0, end: node.position?.end.offset ?? this.source.length }
        });
    }

    /**
     * Starts a line of the template for what follows when a node starts on a later line of the markdown than the line
     * being printed, so what the template says of it names its line. JSX drops the line break between two children.
     * @param node - The node about to be printed.
     */
    private moveTo(node: Nodes): void {
        const line: number = lineOf(node);
        if (line > (this.origins.at(-1)?.line ?? 0)) {
            this.startLine(line);
        }
    }

    /**
     * Where printing is: the number of lines and the length of the last.
     * @returns The position, as a key to compare.
     */
    private printed(): string {
        return `${this.lines.length}:${this.lines.at(-1)?.length ?? 0}`;
    }

    private startLine(line: number): void {
        this.lines.push('        ');
        this.origins.push({ line, column: 0, exact: false });
    }

    /**
     * Appends to the line being printed. A line break in the text, such as in an expression of an mdx file, starts
     * the next line of the template, which leads to the next line of the markdown.
     * @param text - The text.
     */
    private append(text: string): void {
        const [first = '', ...rest] = text.split('\n');
        this.lines[this.lines.length - 1] += first;
        for (const part of rest) {
            const origin: LineOrigin = this.origins.at(-1) ?? { line: 0, column: 0, exact: false };
            this.lines.push(part);
            this.origins.push({ line: origin.line + 1, column: 0, exact: false });
        }
    }
}

/**
 * The props of a construct as the attributes of its element: a text attribute for those written as one, an expression
 * for the rest, and nothing for a prop without a value.
 * @param props - The props.
 * @returns The attributes, each led by a space.
 */
function printProps(props: ConstructProps): string {
    return Object.entries(props)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([name, value]) => TEXT_ATTRIBUTE_PROPS.has(name) && typeof value === 'string'
            ? ` ${name}=${JSON.stringify(value)}`
            : ` ${name}={${JSON.stringify(value)}}`)
        .join('');
}

/**
 * A syntax error of the markdown, at its place.
 * @param error - What the parser threw.
 * @param source - The markdown.
 * @returns The diagnostic.
 * @throws What the parser threw, when it is no syntax error.
 */
function toSyntaxDiagnostic(error: unknown, source: string): Diagnostic {
    if (!(error instanceof Error) || !('place' in error)) {
        throw error;
    }
    const place: unknown = error.place;
    const offset: number = typeof place === 'object' && place != undefined && 'offset' in place && typeof place.offset === 'number'
        ? place.offset
        : 0;
    const reason: string = 'reason' in error && typeof error.reason === 'string' ? error.reason : error.message;
    return {
        code: MarkdownDiagnosticCode.MARKDOWN_INVALID,
        message: `The markdown cannot be read: ${reason}`,
        severity: DiagnosticSeverity.ERROR,
        span: { start: offset, end: Math.min(offset + 1, source.length) }
    };
}

/**
 * How many line breaks a text holds.
 * @param text - The text.
 * @returns The number of line breaks.
 */
function countLines(text: string): number {
    return text.split('\n').length - 1;
}

/**
 * The name a construct is printed under.
 * @param kind - The construct, such as `inlineCode`.
 * @returns The name in PascalCase, such as `InlineCode`.
 */
function toPascalCase(kind: string): string {
    return `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/**
 * The name a type of zibri-tsx is imported under.
 * @param name - The type, such as `MdxLinkProps`.
 * @returns The name, such as `Mdx$LinkProps`.
 */
function toLocalName(name: string): string {
    return name.replace(/^Mdx/, 'Mdx$');
}