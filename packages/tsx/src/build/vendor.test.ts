import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { generateVendorBundles, VendorBundle, VendorBundleOptions } from './vendor';
import { testFileFolder } from '../__testing__/constants';

// Resolution is anchored at the sandbox app, which depends on the browser-shipping packages the
// templates import with `?client`.
const appRoot: string = path.join(__dirname, '..', '..', '..', 'sandbox');

const tempDirs: string[] = [];

async function outDir(): Promise<string> {
    const dir: string = path.join(testFileFolder, `zibri-tsx-vendor-${Date.now()}`);
    await mkdir(dir);
    tempDirs.push(dir);
    return dir;
}

afterAll(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

/**
 * An application root holding one installed package, whose manifest and files are the given ones.
 * @param packageName - The package's name.
 * @param manifest - Its package.json, without the name.
 * @param files - Its files, by path relative to the package, with their content.
 * @returns The application root to resolve from.
 */
async function appWithPackage(packageName: string, manifest: Record<string, unknown>, files: Record<string, string>): Promise<string> {
    const root: string = path.join(testFileFolder, `zibri-tsx-vendor-app-${Date.now()}-${packageName}`);
    tempDirs.push(root);
    const packageDir: string = path.join(root, 'node_modules', packageName);
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'api' }));
    await writeFile(path.join(packageDir, 'package.json'), JSON.stringify({ name: packageName, ...manifest }));
    for (const [file, content] of Object.entries(files)) {
        await mkdir(path.dirname(path.join(packageDir, file)), { recursive: true });
        await writeFile(path.join(packageDir, file), content);
    }
    return root;
}

describe('generateVendorBundles', () => {
    it('does nothing for an empty package list', async () => {
        expect(await generateVendorBundles({ packages: [], outDir: await outDir(), resolveFrom: appRoot })).toEqual([]);
    });

    it('writes a real package browser bundle under its stable file name', async () => {
        const dir: string = await outDir();
        const written: VendorBundle[] = await generateVendorBundles({
            packages: ['chart.js'],
            outDir: dir,
            resolveFrom: appRoot
        });

        expect(written).toEqual([{ packageName: 'chart.js', fileName: 'chart-js.js', written: true }]);
        const contents: string = await readFile(path.join(dir, 'chart-js.js'), 'utf8');
        expect(contents.length).toBeGreaterThan(1000);
    });

    it('leaves an unchanged bundle alone on a second run', async () => {
        const dir: string = await outDir();
        const options: VendorBundleOptions = { packages: ['chart.js'], outDir: dir, resolveFrom: appRoot };
        await generateVendorBundles(options);
        const second: VendorBundle[] = await generateVendorBundles(options);
        expect(second[0].written).toBe(false);
    });

    it('fails with an actionable message for a package without a browser build', async () => {
        await expect(generateVendorBundles({
            packages: ['typescript'],
            outDir: await outDir(),
            resolveFrom: appRoot
        })).rejects.toThrow(/no browser distribution/);
    });

    // the page loads the file with a classic script tag, so a module is a file every
    // browser refuses with "Cannot use import statement outside a module". Refused at build instead,
    // naming the package
    it('refuses a package whose only browser build is an ES module, naming it', async () => {
        const root: string = await appWithPackage(
            'esm-widget',
            { type: 'module', exports: { '.': { browser: './dist/index.js', default: './dist/index.js' } } },
            { 'dist/index.js': 'export const widget = () => 1;\n' }
        );
        const dir: string = await outDir();

        await expect(generateVendorBundles({ packages: ['esm-widget'], outDir: dir, resolveFrom: root }))
            .rejects.toThrow(/'esm-widget'.*ES module.*dist\/index\.js/s);
        await expect(readFile(path.join(dir, 'esm-widget.js'), 'utf8')).rejects.toThrow();
    });

    it('refuses a module told apart by its code when the manifest says nothing', async () => {
        const root: string = await appWithPackage(
            'esm-widget',
            { browser: './dist/index.js' },
            { 'dist/index.js': 'import{a}from"./a.js";const widget=()=>a;export{widget};' }
        );

        await expect(generateVendorBundles({ packages: ['esm-widget'], outDir: await outDir(), resolveFrom: root }))
            .rejects.toThrow(/ES module/);
    });

    it('takes the classic script of a package whose browser entry is a module but whose unpkg build is not', async () => {
        const root: string = await appWithPackage(
            'dual-widget',
            { exports: { '.': { browser: './dist/index.mjs', default: './dist/index.cjs' } }, unpkg: './dist/index.umd.js' },
            {
                'dist/index.mjs': 'export const widget = () => 1;\n',
                'dist/index.cjs': 'exports.widget = () => 1;\n',
                'dist/index.umd.js': '(function (global) { global.widget = function () { return 1; }; })(this);\n'
            }
        );
        const dir: string = await outDir();

        const written: VendorBundle[] = await generateVendorBundles({ packages: ['dual-widget'], outDir: dir, resolveFrom: root });

        expect(written).toEqual([{ packageName: 'dual-widget', fileName: 'dual-widget.js', written: true }]);
        expect(await readFile(path.join(dir, 'dual-widget.js'), 'utf8')).toContain('global.widget');
    });
});