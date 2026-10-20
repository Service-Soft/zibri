import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { build, PluginOption } from 'vite';
import { afterAll, describe, expect, it } from 'vitest';

import { zibriTsx } from './index.ts';
import { testFileFolder } from '../__testing__/constants.ts';

/**
 * An application laid out the way `zi new` lays one out, reduced to what the plugin touches.
 */
type FixtureApp = {
    /**
     * The application root.
     */
    root: string,
    /**
     * The template directory.
     */
    templates: string,
    /**
     * Where the vendor bundles go.
     */
    vendor: string,
    /**
     * Where the build writes.
     */
    outDir: string
};

const tempDirs: string[] = [];

afterAll(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

/**
 * Writes an application whose entry renders a template and reads a `?client` package.
 * @param templates - The template files, by name.
 * @returns Where the application is.
 */
async function writeFixtureApp(templates: Record<string, string>): Promise<FixtureApp> {
    await mkdir(testFileFolder, { recursive: true });
    const root: string = await mkdtemp(path.join(testFileFolder, 'zibri-tsx-vite-'));
    tempDirs.push(root);
    const app: FixtureApp = {
        root,
        templates: path.join(root, 'src', 'templates'),
        vendor: path.join(root, 'assets', 'public', 'vendor'),
        outDir: path.join(root, 'dist')
    };
    await mkdir(app.templates, { recursive: true });
    await Promise.all(Object.entries(templates).map(([name, source]) => writeFile(path.join(app.templates, name), source)));
    await writeFile(path.join(root, 'src', 'index.ts'), [
        'import { Chart } from \'chart.js?client\';',
        'import { renderPage } from \'zibri-tsx\';',
        'import { Home } from \'./templates/home.tsx\';',
        'export const html: string = renderPage(Home, { title: \'Hello\' });',
        'export const chartType: string = typeof Chart;'
    ].join('\n'));
    return app;
}

/**
 * Builds the application with the plugin, as an application's `vite build` does.
 * @param app - The application.
 */
async function buildFixtureApp(app: FixtureApp): Promise<void> {
    await build({
        configFile: false,
        root: app.root,
        logLevel: 'silent',
        plugins: [zibriTsx({ templateDirs: [app.templates], vendorOutDir: app.vendor })],
        // the runtime comes from this package's sources, so the test does not depend on a build of it
        resolve: { alias: [{ find: /^zibri-tsx$/, replacement: path.join(import.meta.dirname, '..', 'index.ts') }] },
        build: { ssr: path.join(app.root, 'src', 'index.ts'), outDir: app.outDir, target: 'node24' }
    });
}

describe('the zibri-tsx Vite plugin', () => {
    it('is a Vite plugin', () => {
        const plugins: PluginOption = zibriTsx({ templateDirs: [], vendorOutDir: '' });

        expect(plugins).toHaveLength(2);
    });

    it('builds an application that renders its templates and reads ?client packages on the server', async () => {
        const app: FixtureApp = await writeFixtureApp({
            'home.tsx': 'export const Home = ({ title }: { title: string }) => <h1>{title}</h1>;'
        });

        await buildFixtureApp(app);

        const built: Record<string, unknown> = await import(pathToFileURL(path.join(app.outDir, 'index.js')).href) as Record<string, unknown>;
        expect(built['html']).toContain('<h1>Hello</h1>');
        expect(built['chartType']).toBe('function');
    });

    it('writes the browser bundles of the ?client packages the templates import', async () => {
        const app: FixtureApp = await writeFixtureApp({
            'home.tsx': 'export const Home = ({ title }: { title: string }) => <h1>{title}</h1>;',
            'chart.tsx': 'import { Chart } from \'chart.js?client\';\nexport const ChartBox = () => <canvas/>;'
        });

        await buildFixtureApp(app);

        const bundle: string = await readFile(path.join(app.vendor, 'chart-js.js'), 'utf8');
        expect(bundle.length).toBeGreaterThan(1000);
    });

    it('fails the build for a template that does not compile, naming the file, line and code', async () => {
        const app: FixtureApp = await writeFixtureApp({
            'home.tsx': '\nexport const Home = async () => <div/>;'
        });

        await expect(buildFixtureApp(app)).rejects.toThrow(/home\.tsx:2:\d+ ZTSX002/);
    });
});
