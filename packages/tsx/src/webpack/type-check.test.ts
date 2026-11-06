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
    'src/templates/pages/page.tsx': string
};

/**
 * Writes a project of its own: an entry ts-loader builds, and a template, which the build hands a loader of
 * its own and so never to ts-loader.
 * @param files - The entry and the template.
 * @returns The project's directory.
 */
function writeProject(files: ProjectFiles): string {
    const root: string = path.join(testFileFolder, `type-check-${randomUUID()}`);
    const tsxSources: string = path.resolve(__dirname, '..');
    writeFile(root, 'tsconfig.json', JSON.stringify({
        compilerOptions: {
            strict: true,
            target: 'es2022',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            jsx: 'react-jsx',
            jsxImportSource: 'zibri-tsx',
            skipLibCheck: true,
            // this package's sources, as a build of zibri-tsx is no requirement of its tests
            paths: {
                'zibri-tsx': [path.join(tsxSources, 'index.ts')],
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
            rules: [{
                test: /\.ts$/,
                loader: 'ts-loader',
                options: { onlyCompileBundledFiles: true, configFile: path.join(root, 'tsconfig.json') }
            }]
        },
        plugins: [new ZibriTsxTypeCheckPlugin({
            tsconfig: path.join(root, 'tsconfig.json'),
            templateDirs: [path.join(root, 'src', 'templates', 'pages')]
        })]
    });
}

/**
 * Builds a project once.
 * @param root - The project's directory.
 * @returns The messages of the build's errors.
 */
async function build(root: string): Promise<string[]> {
    const compiler: Compiler = compilerFor(root);
    const stats: Stats = await new Promise((resolve, reject) => compiler.run((error, result) => {
        if (error != undefined || result == undefined) {
            reject(error ?? new Error('webpack answered no stats'));
            return;
        }
        resolve(result);
    }));
    await new Promise<void>(resolve => compiler.close(() => resolve()));
    return stats.compilation.errors.map(error => error.message);
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
