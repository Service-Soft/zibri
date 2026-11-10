import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import webpack, { Compiler, Stats, Watching } from 'webpack';

import { ZibriTsxTypeCheckPlugin } from './type-check';
import { testFileFolder } from '../__testing__/constants';

const TIMEOUT: number = 60000;

const TEMPLATE: string = 'export const Page = ({ title }: { title: string }) => <h1>{title}</h1>;\n';
// the error on line 2, column 11
const TEMPLATE_WITH_TYPE_ERROR: string = 'export const Page = ({ title }: { title: string }) => {\n'
    + '    const count: number = title;\n'
    + '    return <h1>{title}{count}</h1>;\n'
    + '};\n';

/**
 * The files of a project, by their path inside it.
 */
type ProjectFiles = {
    /**
     * The entry of the bundle.
     */
    'src/index.ts': string,
    /**
     * A template.
     */
    'src/templates/pages/page.tsx': string,
    /**
     * A component the template renders, when it renders one.
     */
    'src/templates/pages/heading.tsx'?: string,
    /**
     * A markdown template.
     */
    'src/templates/pages/imprint.md'?: string,
    /**
     * An mdx template.
     */
    'src/templates/pages/about.mdx'?: string,
    /**
     * What the application declares a page has in its frontmatter.
     */
    'src/frontmatter.d.ts'?: string,
    /**
     * An email template.
     */
    'src/templates/pages/email.tsx'?: string,
    /**
     * A component of the email that places its children in the body.
     */
    'src/templates/pages/email-layout.tsx'?: string,
    /**
     * A component of the email that renders a part of it.
     */
    'src/templates/pages/email-row.tsx'?: string
};

const EMAIL_LAYOUT: string = 'import { Mjml, MjBody } from \'zibri-tsx/email\';\n'
    + 'import { TsxChildren } from \'zibri-tsx\';\n'
    + 'export const EmailLayout = ({ children }: { children: TsxChildren }) => <Mjml><MjBody>{children}</MjBody></Mjml>;\n';

const EMAIL_ROW: string = 'import { MjSection, MjColumn, MjText } from \'zibri-tsx/email\';\n'
    + 'export const EmailRow = ({ text }: { text: string }) => <MjSection><MjColumn><MjText>{text}</MjText></MjColumn></MjSection>;\n';

// renders a column where its use is in the body, on line 1, column 1 of what follows the import
const EMAIL_ROW_OF_A_COLUMN: string = 'import { MjColumn, MjText } from \'zibri-tsx/email\';\n'
    + 'export const EmailRow = ({ text }: { text: string }) => <MjColumn><MjText>{text}</MjText></MjColumn>;\n';

const FRONTMATTER_WITH_TITLE: string = 'declare module \'zibri-tsx\' {\n    interface MdxFrontmatter {\n        title: string\n    }\n}\nexport {};\n';

/**
 * Writes a project of its own: an entry ts-loader builds, and a template, which the build hands a loader of
 * its own and so never to ts-loader.
 * @param files - The entry and the template.
 * @returns The project's directory.
 */
function writeProject(files: ProjectFiles): string {
    const root: string = path.join(testFileFolder, `type-check-${randomUUID()}`);
    const tsxSources: string = path.resolve(__dirname, '..', '..', '..', 'tsx', 'src');
    writeFile(root, 'tsconfig.json', JSON.stringify({
        compilerOptions: {
            strict: true,
            target: 'es2022',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            jsx: 'react-jsx',
            jsxImportSource: 'zibri-tsx',
            skipLibCheck: true,
            // the sources of zibri-tsx, as a build of it is no requirement of these tests
            paths: {
                'zibri-tsx': [path.join(tsxSources, 'index.ts')],
                'zibri-tsx/email': [path.join(tsxSources, 'email', 'index.ts')],
                'zibri-tsx/jsx-runtime': [path.join(tsxSources, 'jsx-runtime.ts')]
            }
        },
        include: ['src']
    }));
    for (const [file, content] of Object.entries(files)) {
        writeFile(root, file, content);
    }
    return root;
}

/**
 * Writes a file of a project.
 * @param root - The project's directory.
 * @param file - The file's path inside it.
 * @param content - What it holds.
 */
function writeFile(root: string, file: string, content: string): void {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
}

/**
 * A compiler building the project the way an application's build does it for the code beside the templates,
 * with the type check of the templates.
 * @param root - The project's directory.
 * @returns The compiler.
 */
function compilerFor(root: string): Compiler {
    return webpack({
        context: root,
        mode: 'none',
        target: 'node',
        entry: './src/index.ts',
        output: { path: path.join(root, 'dist') },
        resolve: { extensions: ['.ts', '.js'] },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    loader: 'ts-loader',
                    options: { onlyCompileBundledFiles: true, configFile: path.join(root, 'tsconfig.json') }
                }
            ]
        },
        plugins: [
            new ZibriTsxTypeCheckPlugin({
                tsconfig: path.join(root, 'tsconfig.json'),
                templateDirs: [path.join(root, 'src', 'templates', 'pages')]
            })
        ]
    });
}

/**
 * What a build reports.
 */
type BuildMessages = {
    /**
     * The messages of its errors.
     */
    errors: string[],
    /**
     * The messages of its warnings.
     */
    warnings: string[]
};

/**
 * Builds a project once.
 * @param root - The project's directory.
 * @returns The messages of the build's errors and warnings.
 */
async function buildMessages(root: string): Promise<BuildMessages> {
    const compiler: Compiler = compilerFor(root);
    const stats: Stats = await new Promise((resolve, reject) => compiler.run((error, result) => {
        if (error != undefined || result == undefined) {
            reject(error ?? new Error('webpack answered no stats'));
            return;
        }
        resolve(result);
    }));
    await new Promise<void>(resolve => compiler.close(() => resolve()));
    return { errors: stats.compilation.errors.map(error => error.message), warnings: stats.compilation.warnings.map(warning => warning.message) };
}

/**
 * Builds a project once.
 * @param root - The project's directory.
 * @returns The messages of the build's errors.
 */
async function build(root: string): Promise<string[]> {
    return (await buildMessages(root)).errors;
}

describe('ZibriTsxTypeCheckPlugin', () => {
    it('fails the build on a type error in a template, naming the file and the line', async () => {
        const root: string = writeProject({ 'src/index.ts': 'export const ready: boolean = true;\n', 'src/templates/pages/page.tsx': TEMPLATE_WITH_TYPE_ERROR });

        const errors: string[] = await build(root);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(`${path.join(root, 'src', 'templates', 'pages', 'page.tsx')}:2:11`);
        expect(errors[0]).toContain('TS2322');
    }, TIMEOUT);

    it('passes a build whose templates have no type error', async () => {
        const root: string = writeProject({ 'src/index.ts': 'export const ready: boolean = true;\n', 'src/templates/pages/page.tsx': TEMPLATE });

        expect(await build(root)).toEqual([]);
    }, TIMEOUT);

    it('leaves a type error outside the templates to the loader that reports it', async () => {
        const root: string = writeProject({ 'src/index.ts': 'export const ready: boolean = 1;\n', 'src/templates/pages/page.tsx': TEMPLATE });

        const errors: string[] = await build(root);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain('index.ts');
    }, TIMEOUT);

    it('passes the next build once the component a template renders takes the prop it is passed', async () => {
        // the order an editor saves them in: the template first, which a build in between checks against the old component
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': 'import { Heading } from \'./heading\';\n'
                + 'export const Page = () => <Heading title="Tasks" subtitle="of the team"/>;\n',
            'src/templates/pages/heading.tsx': 'type Props = { title: string };\n'
                + 'export const Heading = ({ title }: Props) => <h1>{title}</h1>;\n'
        });
        const before: string[] = await build(root);

        writeFile(root, 'src/templates/pages/heading.tsx', 'type Props = { title: string, subtitle: string };\n'
        + 'export const Heading = ({ title, subtitle }: Props) => <h1>{title}<small>{subtitle}</small></h1>;\n');

        expect(before).toHaveLength(1);
        expect(before[0]).toContain('subtitle');
        expect(await build(root)).toEqual([]);
    }, TIMEOUT);

    it('fails the build on frontmatter the application does not declare, naming the line of the markdown', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/frontmatter.d.ts': FRONTMATTER_WITH_TITLE,
            'src/templates/pages/imprint.md': '---\ntitle: 2020\n---\n# Imprint\n'
        });

        const errors: string[] = await build(root);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(`${path.join(root, 'src', 'templates', 'pages', 'imprint.md')}:2:1`);
        expect(errors[0]).toContain('TS2322');
    }, TIMEOUT);

    it('fails the build on a prop the component of an mdx template does not take, naming the line of the markdown', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/heading.tsx': 'export const Heading = ({ title }: { title: string }) => <h1>{title}</h1>;\n',
            'src/templates/pages/about.mdx': 'import { Heading } from \'./heading\';\n\nSome text.\n\n<Heading title="About" subtitle="us"/>\n'
        });

        const errors: string[] = await build(root);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toContain(`${path.join(root, 'src', 'templates', 'pages', 'about.mdx')}:5:1`);
        expect(errors[0]).toContain('subtitle');
    }, TIMEOUT);

    it('passes a build whose markdown templates have the frontmatter the application declares', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': 'import Imprint, { frontmatter } from \'./imprint.md\';\n'
                + 'export const Page = () => <main title={frontmatter.title}><Imprint/></main>;\n',
            'src/frontmatter.d.ts': FRONTMATTER_WITH_TITLE,
            'src/templates/pages/imprint.md': '---\ntitle: Imprint\n---\n# Imprint\n\nRun by **us**.\n'
        });

        expect(await build(root)).toEqual([]);
    }, TIMEOUT);

    it('passes a build whose email places what the components of other files render where MJML allows it', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/email-layout.tsx': EMAIL_LAYOUT,
            'src/templates/pages/email-row.tsx': EMAIL_ROW,
            'src/templates/pages/email.tsx': 'import { MjSection, MjColumn, MjText } from \'zibri-tsx/email\';\n'
                + 'import { EmailLayout } from \'./email-layout\';\n'
                + 'import { EmailRow } from \'./email-row\';\n'
                + 'export const Email = ({ rows }: { rows: string[] }) => <EmailLayout>\n'
                + '    {rows.map(row => <EmailRow text={row}/>)}\n'
                + '    <MjSection><MjColumn><MjText>Bye</MjText></MjColumn></MjSection>\n'
                + '</EmailLayout>;\n'
        });

        expect(await buildMessages(root)).toEqual({ errors: [], warnings: [] });
    }, TIMEOUT);

    it('warns about a component of another file that renders what its parent does not take, at its use', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/email-layout.tsx': EMAIL_LAYOUT,
            'src/templates/pages/email-row.tsx': EMAIL_ROW_OF_A_COLUMN,
            // the use of the row on line 4, column 5
            'src/templates/pages/email.tsx': 'import { EmailLayout } from \'./email-layout\';\n'
                + 'import { EmailRow } from \'./email-row\';\n'
                + 'export const Email = () => <EmailLayout>\n'
                + '    <EmailRow text="Hello"/>\n'
                + '</EmailLayout>;\n'
        });

        const { errors, warnings } = await buildMessages(root);

        expect(errors).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`${path.join(root, 'src', 'templates', 'pages', 'email.tsx')}:4:5 ZTSX004`);
        expect(warnings[0]).toContain('\'EmailRow\' renders \'MjColumn\', which is not a valid child of \'MjBody\', where \'EmailLayout\' places it.');
        expect(warnings[0]).toContain('This fails the build from 4.0.');
    }, TIMEOUT);

    it('warns about children a component of another file places where MJML does not allow them, at the child', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/email-layout.tsx': EMAIL_LAYOUT,
            // the column on line 3, column 5
            'src/templates/pages/email.tsx': 'import { MjColumn } from \'zibri-tsx/email\';\n'
                + 'import { EmailLayout } from \'./email-layout\';\n'
                + 'export const Email = () => <EmailLayout>\n'
                + '    <MjColumn></MjColumn>\n'
                + '</EmailLayout>;\n'
        });

        const { errors, warnings } = await buildMessages(root);

        expect(errors).toEqual([]);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`${path.join(root, 'src', 'templates', 'pages', 'email.tsx')}:4:5 ZTSX004`);
        expect(warnings[0]).toContain('\'MjColumn\' is not a valid child of \'MjBody\', where \'EmailLayout\' places it.');
    }, TIMEOUT);

    it('leaves a mistake of a template alone to the loader that reports it', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/email.tsx': 'import { Mjml, MjBody, MjColumn } from \'zibri-tsx/email\';\n'
                + 'const Row = () => <MjColumn></MjColumn>;\n'
                + 'export const Email = () => <Mjml><MjBody><MjColumn></MjColumn><Row/></MjBody></Mjml>;\n'
        });

        expect(await buildMessages(root)).toEqual({ errors: [], warnings: [] });
    }, TIMEOUT);

    it('stops warning in the next build once the component of another file renders what its parent takes', async () => {
        const root: string = writeProject({
            'src/index.ts': 'export const ready: boolean = true;\n',
            'src/templates/pages/page.tsx': TEMPLATE,
            'src/templates/pages/email-layout.tsx': EMAIL_LAYOUT,
            'src/templates/pages/email-row.tsx': EMAIL_ROW_OF_A_COLUMN,
            'src/templates/pages/email.tsx': 'import { EmailLayout } from \'./email-layout\';\n'
                + 'import { EmailRow } from \'./email-row\';\n'
                + 'export const Email = () => <EmailLayout><EmailRow text="Hello"/></EmailLayout>;\n'
        });
        const before: BuildMessages = await buildMessages(root);

        writeFile(root, 'src/templates/pages/email-row.tsx', EMAIL_ROW);

        expect(before.warnings).toHaveLength(1);
        expect(await buildMessages(root)).toEqual({ errors: [], warnings: [] });
    }, TIMEOUT);

    it('passes the rebuild of watch mode once the template is fixed', async () => {
        const root: string = writeProject({ 'src/index.ts': 'export const ready: boolean = true;\n', 'src/templates/pages/page.tsx': TEMPLATE_WITH_TYPE_ERROR });
        const compiler: Compiler = compilerFor(root);
        const builds: string[][] = [];

        await new Promise<void>((resolve, reject) => {
            const watching: Watching | undefined = compiler.watch({ aggregateTimeout: 50 }, (error, stats) => {
                if (error != undefined || stats == undefined) {
                    reject(error ?? new Error('webpack answered no stats'));
                    return;
                }
                builds.push(stats.compilation.errors.map(entry => entry.message));
                if (builds.length === 1) {
                    writeFile(root, 'src/templates/pages/page.tsx', TEMPLATE);
                    return;
                }
                watching?.close(() => resolve());
            });
        });

        expect(builds[0]).toHaveLength(1);
        expect(builds[1]).toEqual([]);
    }, TIMEOUT);
});