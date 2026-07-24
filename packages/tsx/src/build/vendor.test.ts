import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { generateVendorBundles, VendorBundle, VendorBundleOptions } from './vendor';

// Resolution is anchored at the sandbox app, which depends on the browser-shipping packages the
// templates import with `?client`.
const appRoot: string = join(__dirname, '..', '..', '..', 'sandbox');

const tempDirs: string[] = [];

async function outDir(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'zibri-tsx-vendor-'));
    tempDirs.push(dir);
    return dir;
}

afterAll(async () => {
    await Promise.all(tempDirs.map(dir => rm(dir, { recursive: true, force: true })));
});

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
        const contents: string = await readFile(join(dir, 'chart-js.js'), 'utf8');
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
});