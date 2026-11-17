import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import * as zibriMdx from 'zibri-mdx';
import * as zibriTsx from 'zibri-tsx';
import { MdxComponentsContext } from 'zibri-tsx';
import { CompiledComponent, createServerRuntime, offsetToLineColumn, renderChild, RenderServerRuntime } from 'zibri-tsx/internal';

import { MarkdownCompilerUtilities } from './markdown-compiler';
import { MarkdownPrinterModule } from './markdown-printer.model';
import { compileComponent, isCompiledPage, loadCjs, LoadedMarkdownPage, loadMarkdownPage, renderTestPage } from '../__testing__/server-render.helper';
import { compile, CompileResult } from '../codegen/compile';
import { decodeMappings } from '../codegen/source-map';
import { ValidationCode } from '../semantics/validate';

/**
 * Renders a markdown template as a page, and hands back what it renders.
 * @param source - The markdown.
 * @param kind - Whether it is plain markdown or mdx.
 * @param props - The props to render it with.
 * @param components - The components a render provides for its constructs.
 * @returns The html of the page, without the doctype.
 */
function renderBody(
    source: string,
    kind: 'md' | 'mdx' = 'md',
    props: Record<string, unknown> = {},
    components?: Record<string, CompiledComponent>
): string {
    const { page }: LoadedMarkdownPage = loadMarkdownPage(source, kind);
    const document: string = renderTestPage(page, props, components === undefined ? {} : { contexts: [{ context: MdxComponentsContext, value: components }] });
    return document.replace(/^<!DOCTYPE html>\n/, '');
}

/**
 * The line of the markdown a diagnostic of compiling it is on.
 * @param source - The markdown.
 * @param result - What compiling it gave.
 * @returns The 1-based line of its first diagnostic.
 */
function lineOfFirstDiagnostic(source: string, result: CompileResult): number | undefined {
    const [diagnostic] = result.diagnostics;
    return diagnostic === undefined ? undefined : offsetToLineColumn(source, diagnostic.span.start).line;
}

describe('a markdown template', () => {
    it('renders each construct as its plain element when nothing chooses a component for it', () => {
        const source: string = [
            '# Imprint',
            '',
            'Run by *Service Soft*, **since 2020**, ~~never~~ with `code` and a [link](https://example.com "Example").',
            '',
            '> Quoted',
            '',
            '- one',
            '- two',
            '',
            '3. three',
            '4. four',
            '',
            '---',
            '',
            '![A logo](/logo.png)'
        ].join('\n');

        expect(renderBody(source)).toBe([
            '<h1 id="imprint">Imprint</h1>',
            '<p>Run by <em>Service Soft</em>, <strong>since 2020</strong>, <del>never</del> with <code>code</code> and a ',
            '<a href="https://example.com" title="Example">link</a>.</p>',
            '<blockquote><p>Quoted</p></blockquote>',
            '<ul><li>one</li><li>two</li></ul>',
            '<ol start="3"><li>three</li><li>four</li></ol>',
            '<hr/>',
            '<p><img src="/logo.png" alt="A logo"/></p>'
        ].join(''));
    });

    it('gives a heading the anchor GitHub gives it, numbering a repeated one', () => {
        const source: string = '## Naming the `servers`!\n\n## Usage\n\n## Usage';

        expect(renderBody(source)).toBe('<h2 id="naming-the-servers">Naming the <code>servers</code>!</h2>'
            + '<h2 id="usage">Usage</h2><h2 id="usage-1">Usage</h2>');
    });

    it('renders a table with the alignment of its columns, and a task list with its boxes', () => {
        const source: string = '| Name | Count |\n|:---|---:|\n| a | 1 |\n\n- [x] done\n- [ ] open';

        expect(renderBody(source)).toBe('<table><thead><tr><th align="left">Name</th><th align="right">Count</th></tr></thead>'
            + '<tbody><tr><td align="left">a</td><td align="right">1</td></tr></tbody></table>'
            + '<ul><li><input type="checkbox" checked disabled/>done</li><li><input type="checkbox" disabled/>open</li></ul>');
    });

    it('hands a construct without content its children all the same, such as an empty cell', () => {
        const cell: CompiledComponent = compileComponent('const Cell = ({ children }) => <td data-empty={children === null}>{children}</td>;');

        expect(renderBody('| Name | Note |\n|---|---|\n| a | |', 'md', {}, { tableCell: cell }))
            .toContain('<td>a</td><td data-empty></td>');
    });

    it('renders an alert as GitHub writes it as a blockquote titled by its kind, without the line naming it', () => {
        const source: string = '> [!WARNING]\n> Changing `relyingPartyId` makes every passkey unusable.\n\n> [!NOTE]\n>\n> A limit.';

        expect(renderBody(source)).toBe('<blockquote><p><strong>Warning</strong></p>'
            + '<p>Changing <code>relyingPartyId</code> makes every passkey unusable.</p></blockquote>'
            + '<blockquote><p><strong>Note</strong></p><p>A limit.</p></blockquote>');
    });

    it('hands the component of a blockquote the kind of alert it is', () => {
        const blockquote: CompiledComponent = compileComponent('const Quote = ({ alert, children }) => <aside data-alert={alert}>{children}</aside>;');

        expect(renderBody('> [!CAUTION]\n> Hot.\n\n> Said once.', 'md', {}, { blockquote }))
            .toBe('<aside data-alert="caution"><p>Hot.</p></aside><aside><p>Said once.</p></aside>');
    });

    it('leaves a blockquote whose first line names no alert as it is written', () => {
        expect(renderBody('> [!SOMETHING]\n> Text.\n\n> [!NOTE] on the same line')).toBe('<blockquote><p>[!SOMETHING]\nText.</p></blockquote>'
            + '<blockquote><p>[!NOTE] on the same line</p></blockquote>');
    });

    it('renders text as text, whatever it holds', () => {
        expect(renderBody('A `<script>` and {braces} and &lt;b&gt;')).toBe('<p>A <code>&lt;script&gt;</code> and {braces} and &lt;b&gt;</p>');
    });

    it('links a footnote to its entry at the end of the page, and back', () => {
        const source: string = 'Said once.[^source]\n\n[^source]: In a book.';

        expect(renderBody(source)).toBe('<p>Said once.<sup><a href="#user-content-fn-source" id="user-content-fnref-source">1</a></sup></p>'
            + '<section class="footnotes"><ol><li id="user-content-fn-source"><p>In a book.</p>'
            + '<a href="#user-content-fnref-source">↩</a></li></ol></section>');
    });

    it('resolves a link written as a reference to its definition', () => {
        expect(renderBody('See [the docs][docs].\n\n[docs]: https://example.com/docs')).toBe('<p>See <a href="https://example.com/docs">the docs</a>.</p>');
    });

    it('renders the components the render provides for its constructs, with the props of each', () => {
        const heading: CompiledComponent = compileComponent('const Heading = ({ tag, id, children }) => <div className={`heading ${tag}`} id={id}>{children}</div>;');
        const link: CompiledComponent = compileComponent('const Link = ({ href, children }) => <a className="link" href={href}>{children}</a>;');

        expect(renderBody('## Title\n\nA [link](/x).', 'md', {}, { heading, link }))
            .toBe('<div class="heading h2" id="title">Title</div><p>A <a class="link" href="/x">link</a>.</p>');
    });

    it('renders the components its components prop names over the ones the render provides', () => {
        const provided: CompiledComponent = compileComponent('const Provided = ({ children }) => <p className="provided">{children}</p>;');
        const own: CompiledComponent = compileComponent('const Own = ({ children }) => <p className="own">{children}</p>;');

        expect(renderBody('Text', 'md', { components: { paragraph: own } }, { paragraph: provided })).toBe('<p class="own">Text</p>');
    });

    it('exports its frontmatter', () => {
        const { exports }: LoadedMarkdownPage = loadMarkdownPage('---\ntitle: Imprint\ntags:\n  - legal\n---\n# Imprint', 'md');

        expect(exports['frontmatter']).toEqual({ title: 'Imprint', tags: ['legal'] });
    });

    it('exports an empty frontmatter when it has none', () => {
        expect(loadMarkdownPage('# Imprint', 'md').exports['frontmatter']).toEqual({});
    });

    it('exports its headings in order, each with its level, its text and the anchor it renders with', () => {
        const source: string = '# Imprint\n\n## Naming the `servers`!\n\n> ### Quoted\n\n## Usage\n\n## Usage';

        expect(loadMarkdownPage(source, 'md').exports['headings']).toEqual([
            { depth: 1, text: 'Imprint', id: 'imprint' },
            { depth: 2, text: 'Naming the servers!', id: 'naming-the-servers' },
            { depth: 3, text: 'Quoted', id: 'quoted' },
            { depth: 2, text: 'Usage', id: 'usage' },
            { depth: 2, text: 'Usage', id: 'usage-1' }
        ]);
    });

    it('exports no heading whose text an expression computes, which has no anchor', () => {
        const source: string = 'export const product = \'Tasks\';\n\n# {product}\n\n## Pricing';

        expect(loadMarkdownPage(source, 'mdx').exports['headings']).toEqual([{ depth: 2, text: 'Pricing', id: 'pricing' }]);
    });

    it('refuses frontmatter that is no mapping, at its line', () => {
        const source: string = '---\n- a list\n---\n# Title';

        const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'md');

        expect(result.code).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe(ValidationCode.MARKDOWN_INVALID);
        expect(result.diagnostics[0]?.message).toContain('needs to be a mapping');
        expect(lineOfFirstDiagnostic(source, result)).toBe(1);
    });

    it('highlights the code of a code block, its tokens as classes, and hands the component the code as written', () => {
        const codeBlock: CompiledComponent = compileComponent('const CodeBlock = ({ language, code, children }) => '
            + '<pre data-language={language} data-code={code}>{children}</pre>;');

        const body: string = renderBody('```ts\nconst a = 1;\n```', 'md', {}, { codeBlock });

        expect(body).toContain('<pre data-language="ts" data-code="const a = 1;">');
        expect(body).toContain('<span class="shiki-token-keyword">const</span>');
        expect(body).not.toContain('style=');
    });

    it('tells apart the kinds of token VS Code colors apart, one class each', () => {
        const body: string = renderBody('```ts\nimport { Invoice } from \'./invoice\';\nlet total: Invoice = MAX_TOTAL;\n```');

        expect(body).toContain('<span class="shiki-token-keyword-control">import</span>');
        expect(body).toContain('<span class="shiki-token-keyword">let</span>');
        expect(body).toContain('<span class="shiki-token-type">Invoice</span>');
        expect(body).toContain('<span class="shiki-token-variable">total</span>');
        expect(body).toContain('<span class="shiki-token-constant">MAX_TOTAL</span>');
    });

    it('highlights a language another embeds, before any code block of that language', () => {
        // no block of yaml comes before this one, so its grammar is loaded with the one of markdown or not at all
        const body: string = renderBody('````md\n---\ntitle: About us\n---\n````');

        expect(body).toContain('<span class="shiki-token-keyword">title</span>');
        expect(body).toContain('<span class="shiki-token-string">About us</span>');
    });

    it('hands the component of an inline code span the code as written', () => {
        const inlineCode: CompiledComponent = compileComponent('const InlineCode = ({ code, children }) => <code data-code={code}>{children}</code>;');

        expect(renderBody('Use `a < b` here.', 'md', {}, { inlineCode })).toBe('<p>Use <code data-code="a &lt; b">a &lt; b</code> here.</p>');
    });

    it('keeps the lines of a code block', () => {
        expect(renderBody('```\nfirst\n  second\n```')).toBe('<pre><code>first\n  second</code></pre>');
    });

    it('leaves the code of a language the highlighter does not know as it is, and warns of it at its line', () => {
        const source: string = 'Intro\n\n```made-up\nx = 1\n```';
        const { warnings }: LoadedMarkdownPage = loadMarkdownPage(source, 'md');

        expect(renderBody(source)).toBe('<p>Intro</p><pre><code class="language-made-up">x = 1</code></pre>');
        expect(warnings.map(warning => warning.code)).toEqual([ValidationCode.CODE_LANGUAGE_UNKNOWN]);
        expect(offsetToLineColumn(source, warnings[0]?.span.start ?? 0).line).toBe(3);
    });

    it('refuses html in a .md file, at its line', () => {
        const source: string = '# Title\n\n<div>raw</div>';

        const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'md');

        expect(result.code).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe(ValidationCode.MARKDOWN_INVALID);
        expect(result.diagnostics[0]?.message).toContain('.mdx');
        expect(lineOfFirstDiagnostic(source, result)).toBe(3);
    });

    it('leaves out an html comment, as it is no markup', () => {
        expect(renderBody('<!-- the legal team checks this page -->\n\n# Imprint\n\nText <!-- inline --> here.'))
            .toBe('<h1 id="imprint">Imprint</h1><p>Text  here.</p>');
    });

    it('leads its source map to the markdown: a statement to its line, the markup to the line it starts on', () => {
        const source: string = '---\ntitle: Imprint\n---\nexport const year = 2020;\n\n# Title\n\nText';

        const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'mdx', { module: 'cjs', fileName: 'page.mdx' });
        const lines: Set<number> = new Set(decodeMappings(result.map?.mappings ?? '').flat()
            .map(segment => segment.sourceLine));

        expect(result.map?.sources).toEqual(['page.mdx']);
        expect(result.map?.sourcesContent).toEqual([source]);
        // 0-based: the field of the frontmatter, the export and the heading the markup starts with
        expect(lines).toContain(1);
        expect(lines).toContain(3);
        expect(lines).toContain(5);
    });
});

describe('a markdown template in an email', () => {
    it('renders in the text of an email, with the components the render provides for emails', () => {
        const { page: welcome }: LoadedMarkdownPage = loadMarkdownPage('# Welcome\n\nSee [your tasks](https://app.example.com/tasks).', 'md');
        const email: CompileResult = compile([
            'import { Mjml, MjBody, MjSection, MjColumn, MjText } from \'zibri-tsx\';',
            'import Welcome from \'./welcome.md\';',
            'export const WelcomeEmail = () => <Mjml><MjBody><MjSection><MjColumn><MjText><Welcome/></MjText></MjColumn></MjSection></MjBody></Mjml>;'
        ].join('\n'), { module: 'cjs' });
        const link: CompiledComponent = compileComponent('const Link = ({ href, children }) => <a href={href} style={{ color: \'#0e456f\' }}>{children}</a>;');
        // a module with a default export, as the build emits one
        const exported: Record<string, unknown> = loadCjs(email.code ?? '', id => id === 'zibri-tsx' ? zibriTsx : { __esModule: true, default: welcome });
        const template: unknown = exported['WelcomeEmail'];
        if (!isCompiledPage(template)) {
            throw new Error(`The email does not compile: ${email.diagnostics.map(diagnostic => diagnostic.message).join('\n')}`);
        }
        const runtime: RenderServerRuntime = createServerRuntime('development');
        // as the contexts of renderPage are provided: a compiled component is no function, which a template declares it as
        runtime.provideContext<unknown>(MdxComponentsContext, { link });

        const html: string = renderChild(template.render({}, runtime));

        expect(html).toContain('<h1 id="welcome">Welcome</h1>');
        expect(html).toContain('<a href="https://app.example.com/tasks" style="color:#0e456f">your tasks</a>');
    });
});

describe('an mdx template', () => {
    it('renders the components it imports, with the markdown inside them', () => {
        const card: CompiledComponent = compileComponent('const Card = ({ title, children }) => <section title={title}>{children}</section>;');
        const source: string = 'import { Card } from \'./card\';\n\n<Card title="Hi">\n  Some *text*.\n</Card>';
        const { page }: LoadedMarkdownPage = loadMarkdownPage(source, 'mdx', { './card': { Card: card } });

        expect(renderTestPage(page)).toContain('<section title="Hi"><p>Some <em>text</em>.</p></section>');
    });

    it('renders its expressions, which may read its frontmatter and its own exports', () => {
        const source: string = '---\ntitle: Imprint\n---\nexport const year = 2020;\n\n## {frontmatter.title}\n\nSince {year + 1}.';

        // the text of the heading is only known once it renders, so it has no anchor
        expect(renderBody(source, 'mdx')).toBe('<h2>Imprint</h2><p>Since 2021.</p>');
    });

    it('loads the ?client package it imports in the page, for the code its elements run in the browser', () => {
        const source: string = 'import { Chart } from \'chart.js?client\';\n\n<button onClick={() => console.log(Chart.version)}>Log</button>';

        const body: string = renderBody(source, 'mdx');

        expect(MarkdownCompilerUtilities.compileMarkdown(source, 'mdx').clientPackages).toEqual(['chart.js']);
        expect(body).toMatch(/<script src="\/assets\/vendor\/[^"]*chart[^"]*"/);
        expect(body).toContain('Chart.version');
    });

    it('refuses a syntax error, at its line', () => {
        const source: string = '# Title\n\nSum: {1 +}\n\nMore text';

        const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'mdx');

        expect(result.code).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe(ValidationCode.MARKDOWN_INVALID);
        expect(lineOfFirstDiagnostic(source, result)).toBe(3);
    });

    it('names the line of the markdown for what the compiler refuses in it', () => {
        // client code reading an import, which the compiler refuses as for any template
        const source: string = 'import { secret } from \'./secret\';\n\n# Title\n\n<button onClick={() => console.log(secret)}>Log</button>';

        const result: CompileResult = MarkdownCompilerUtilities.compileMarkdown(source, 'mdx');

        expect(result.code).toBeUndefined();
        expect(result.diagnostics[0]?.code).toBe(ValidationCode.SERVER_IMPORT_IN_CLIENT_CODE);
        expect(lineOfFirstDiagnostic(source, result)).toBe(5);
    });
});

/**
 * The sections of a manifest naming what is installed with a package, or beside it.
 */
type DeclaredPackages = {
    /**
     * What is installed with it.
     */
    dependencies?: Record<string, string>,
    /**
     * What it asks to be installed beside it.
     */
    peerDependencies?: Record<string, string>,
    /**
     * What is installed with it where it can be.
     */
    optionalDependencies?: Record<string, string>
};

/**
 * Reads what a package of this repository declares.
 * @param folder - The folder of the package under `packages`.
 * @returns The sections of its manifest.
 * @throws When the manifest holds no object.
 */
function readDeclaredPackages(folder: string): DeclaredPackages {
    const manifest: unknown = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', folder, 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest === null) {
        throw new Error(`packages/${folder}/package.json holds no object`);
    }
    return manifest;
}

describe('the printer of markdown templates', () => {
    it('is left to the project, so a deployment carries neither it nor what it parses with', () => {
        const declared: DeclaredPackages = readDeclaredPackages('tsx');
        const printer: string[] = ['zibri-mdx', ...Object.keys(readDeclaredPackages('mdx').dependencies ?? {})];
        const named: string[] = [declared.dependencies, declared.peerDependencies, declared.optionalDependencies]
            .flatMap(section => Object.keys(section ?? {}));

        // npm keeps a package a production package names in a deployment, even an optional peer that only the
        // project's devDependencies install. zibri-tsx is one, and the printer is only what building needs
        expect(named.filter(name => printer.includes(name))).toStrictEqual([]);
    });

    it('names neither the compiler nor TypeScript, so a deployment rendering markdown at runtime carries neither', () => {
        const declared: DeclaredPackages = readDeclaredPackages('mdx');
        const named: string[] = [declared.dependencies, declared.peerDependencies, declared.optionalDependencies]
            .flatMap(section => Object.keys(section ?? {}));

        // such a deployment lists zibri-mdx in its dependencies, and keeps every package it names: the compiler and
        // TypeScript would be 23 MB of it, for markdown that is never compiled
        expect(named.filter(name => name === 'zibri-tsx-compiler' || name === 'typescript')).toStrictEqual([]);
    });

    it('is what the compiler loads it as, though it declares the contract itself', () => {
        // a type test: zibri-mdx cannot import the contract from the compiler it does not name
        const printerModule: MarkdownPrinterModule = zibriMdx;

        expect(typeof printerModule.MarkdownPrinterUtilities.printMarkdown).toBe('function');
    });
});