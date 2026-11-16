import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { MdxComponent, MdxComponents, MdxHeadingProps, MdxPage } from 'zibri-tsx';

import { Markdown } from './markdown.component';
import { MarkdownService } from './markdown.service';
import { TsxComponent } from './tsx-component.model';
import { TsxUtilities } from './tsx.utilities';
import { compileMarkdownTemplate, compileTsxTemplate } from '../__testing__/compile-tsx-template.function';
import { ZibriApplicationOptions } from '../application/application-options.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../di/init-di-container.function';
import { defineProvider } from '../di/models/di-provider.model';
import { register } from '../di/register.function';
import { GlobalRegistry } from '../global/global-registry';

const applicationOptions: ZibriApplicationOptions = {
    name: 'Task Tracker',
    version: '1.0.0',
    environment: 'development',
    baseUrl: 'http://localhost:3000',
    controllers: [],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};

/**
 * Markdown holding every construct, and what a construct renders differently in: a heading of the same text twice, a
 * tight and a loose list, a task list, a list starting at another number, an aligned table with an empty cell, code of a
 * language the highlighter knows, of one it does not and of plain text, a reference and a footnote.
 */
const EVERY_CONSTRUCT: string = [
    '---',
    'title: Tasks',
    '---',
    '# Tasks of a *team*',
    '',
    'Text with **strong**, _emphasis_, ~~struck~~, `code`, a [link](https://example.com "Example"), a [reference][docs], '
    + 'an ![image](/logo.png "Logo") and a footnote[^note].',
    'A line  ',
    'broken.',
    '',
    '> A quote',
    '',
    '> [!WARNING]',
    '> An alert',
    '',
    '## Tasks',
    '',
    '## Tasks',
    '',
    '- tight',
    '- list',
    '',
    '3. starting',
    '4. at three',
    '',
    '- loose',
    '',
    '- list',
    '',
    '- [x] done',
    '- [ ] open',
    '',
    '| Task | Hours |',
    '|:-----|------:|',
    '| Write | 3 |',
    '| Read | |',
    '',
    '```ts',
    'const done: boolean = true;',
    '```',
    '',
    '```made-up',
    'nothing to highlight',
    '```',
    '',
    '```text',
    'plain',
    '```',
    '',
    '---',
    '',
    '[docs]: https://example.com/docs',
    '[^note]: The footnote.'
].join('\n');

/**
 * A heading with client behavior, as an application maps one.
 */
const HEADING_TEMPLATE: string = 'declare const track: (...values: unknown[]) => void;\n'
    + 'export const Heading = ({ tag, id, children }) => { onClient(() => { track(id); }); const Tag = tag; '
    + 'return <Tag id={id} className="title">{children}</Tag>; };';

/**
 * A page rendering markdown it is handed, inside its layout.
 */
const POST_TEMPLATE: string = 'export const Post = ({ body, components }) => '
    + '<main><Markdown source={body} components={components}/></main>;';

/**
 * The page markdown renders at runtime.
 * @param source - The markdown.
 * @returns The page.
 */
function runtimePageOf(source: string): MdxPage {
    return new MarkdownService({ renderAtRuntime: true }).resolvePage(source);
}

/**
 * A document with the number of every instance of a component left out.
 * @param document - The document.
 * @returns The document, each instance numbered 0.
 */
function withoutInstanceNumbers(document: string): string {
    return document.replaceAll(/"owner":\d+/g, '"owner":0');
}

describe('Markdown', () => {
    const post: TsxComponent<{ body: string, components?: MdxComponents }> = compileTsxTemplate(POST_TEMPLATE, { Markdown });
    // what ZIBRI_DI_TOKENS.MDX_COMPONENTS names, filled by the test that maps a construct: the container keeps the value
    // a token resolved to, so it is registered once, before anything reads it
    const mdxComponents: Record<string, unknown> = {};

    beforeAll(() => {
        initDiContainer();
        register(defineProvider({ token: ZIBRI_DI_TOKENS.MARKDOWN_SERVICE, useValue: new MarkdownService({ renderAtRuntime: true }) }));
        register(defineProvider({ token: ZIBRI_DI_TOKENS.MDX_COMPONENTS, useValue: mdxComponents }));
        GlobalRegistry.setAppData(applicationOptions);
    });

    afterAll(() => {
        GlobalRegistry.markAppAsCreated();
        GlobalRegistry.markAppAsShuttingDown();
        GlobalRegistry.markAppAsOffline();
    });

    it('is refused unless the application renders markdown at runtime, naming what to set', () => {
        expect(() => new MarkdownService({ renderAtRuntime: false }).resolvePage('# Tasks')).toThrow(
            'Rendering markdown at runtime needs renderAtRuntime: true in ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS'
        );
    });

    describe('in an application rendering markdown at runtime', () => {
        it('renders the document a .md template of the same markdown renders', () => {
            expect(TsxUtilities.renderPage(runtimePageOf(EVERY_CONSTRUCT)))
                .toBe(TsxUtilities.renderPage(compileMarkdownTemplate<MdxPage>(EVERY_CONSTRUCT)));
        });

        it('renders the components of ZIBRI_DI_TOKENS.MDX_COMPONENTS as a .md template does, their client behavior with them', () => {
            mdxComponents['heading'] = compileTsxTemplate(HEADING_TEMPLATE);
            try {
                const document: string = TsxUtilities.renderPage(runtimePageOf(EVERY_CONSTRUCT));

                // the number of each instance is a counter of the render tying its setup to it, and counts components: a
                // plain element of a .md page is a component of the page, one rendered at runtime is none
                expect(withoutInstanceNumbers(document))
                    .toBe(withoutInstanceNumbers(TsxUtilities.renderPage(compileMarkdownTemplate<MdxPage>(EVERY_CONSTRUCT))));
                expect(document).toContain('<h2 id="tasks-1" class="title">');
                expect(document).toContain('<script>');
            }
            finally {
                delete mdxComponents['heading'];
            }
        });

        it('renders inside the page that hands it the markdown, escaping its text', () => {
            const document: string = TsxUtilities.renderPage(post, { body: 'Estimate < 3 & due [soon](javascript:alert(1))' });

            expect(document).toContain('<main><p>Estimate &lt; 3 &amp; due <a>soon</a></p></main>');
        });

        it('renders the components the page hands it over those of the context', () => {
            const heading: MdxComponent<MdxHeadingProps> = compileTsxTemplate(HEADING_TEMPLATE);

            const document: string = TsxUtilities.renderPage(post, { body: '# Tasks', components: { heading } });

            expect(document).toContain('<main><h1 id="tasks" class="title">Tasks</h1></main>');
        });

        it('refuses html as a mistake only the render can see, which throws in development', () => {
            expect(() => TsxUtilities.renderPage(post, { body: 'Due <b>today</b>' }))
                .toThrow('The markdown holds the html \'<b>\', which markdown rendered at runtime does not hold.');
        });

        it('leaves html out in production, and renders the rest', () => {
            GlobalRegistry.setAppData({ ...applicationOptions, environment: 'production' });
            try {
                expect(TsxUtilities.renderPage(post, { body: 'Due <b>today</b>' })).toContain('<main><p>Due today</p></main>');
            }
            finally {
                GlobalRegistry.setAppData(applicationOptions);
            }
        });
    });
});