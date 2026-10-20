import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { vendorFileName } from '../vendor-file-name.ts';

const PACKAGE_MANIFEST: string = 'package.json';

/**
 * Options for generating vendor bundles for `?client` packages.
 */
export type VendorBundleOptions = {
    /**
     * The `?client` package names to bundle.
     */
    packages: string[],
    /**
     * Directory the bundles are written to (created if missing).
     */
    outDir: string,
    /**
     * Directory whose `package.json` anchors module resolution — normally the application root, so
     * packages resolve from the app's `node_modules`.
     */
    resolveFrom: string
};

/**
 * A written vendor bundle.
 */
export type VendorBundle = {
    /**
     * The package the bundle came from.
     */
    packageName: string,
    /**
     * The file name written into `outDir`.
     */
    fileName: string,
    /**
     * Whether the file changed (false when the existing content already matched).
     */
    written: boolean
};

/**
 * Resolves each package's browser distribution and writes it into `outDir` under a stable file name.
 * Existing files with identical content are left untouched so builds stay incremental.
 * @param options - The packages, output directory and resolution root.
 * @returns One entry per package describing what was written.
 * @throws When a package has no browser distribution to serve.
 */
export async function generateVendorBundles(options: VendorBundleOptions): Promise<VendorBundle[]> {
    const { packages, outDir, resolveFrom } = options;
    if (packages.length === 0) {
        return [];
    }
    await mkdir(outDir, { recursive: true });
    const require: NodeJS.Require = createRequire(join(resolveFrom, PACKAGE_MANIFEST));

    return await Promise.all(packages.map(async packageName => {
        const code: string = await readBrowserDist(packageName, require);
        const fileName: string = vendorFileName(packageName);
        const target: string = join(outDir, fileName);
        if (await matchesExisting(target, code)) {
            return { packageName, fileName, written: false };
        }
        await writeFile(target, code, 'utf8');
        return { packageName, fileName, written: true };
    }));
}

/**
 * Whether a file already contains the given content.
 * @param file - The file to compare.
 * @param code - The content to compare against.
 * @returns True when the file exists with equivalent content.
 */
async function matchesExisting(file: string, code: string): Promise<boolean> {
    try {
        return (await readFile(file, 'utf8')).trim() === code.trim();
    }
    catch {
        return false;
    }
}

/**
 * Reads a package's browser distribution bundle.
 * @param packageName - The package to resolve.
 * @param require - A require anchored at the application root.
 * @returns The bundle source.
 * @throws When the package exposes no browser distribution.
 */
async function readBrowserDist(packageName: string, require: NodeJS.Require): Promise<string> {
    const packageDir: string = findPackageDir(packageName, require);
    const manifest: Record<string, unknown> = JSON.parse(
        await readFile(join(packageDir, PACKAGE_MANIFEST), 'utf8')
    ) as Record<string, unknown>;

    const entry: string | undefined = resolveBrowserEntry(manifest);
    if (!entry) {
        throw new Error(
            `Package '${packageName}' has no browser distribution. It must expose one via `
            + '\'browser\', \'unpkg\', \'cdn\', or exports[\'browser\'] in its package.json.'
        );
    }
    return await readFile(join(packageDir, entry), 'utf8');
}

/**
 * Locates a package's root directory.
 * @param packageName - The package to locate.
 * @param require - A require anchored at the application root.
 * @returns The package root directory.
 * @throws When the package root cannot be determined.
 */
function findPackageDir(packageName: string, require: NodeJS.Require): string {
    try {
        return dirname(require.resolve(`${packageName}/${PACKAGE_MANIFEST}`));
    }
    catch {
        // Many packages block `package.json` in their exports map, and the resulting error differs
        // between runtimes, so any failure here falls through to the entry-walking path below.
    }
    // Walk up from the resolved main entry until the directory declares this package.
    let dir: string = dirname(require.resolve(packageName));
    while (true) {
        if (isPackageRoot(dir, packageName)) {
            return dir;
        }
        const parent: string = dirname(dir);
        if (parent === dir) {
            throw new Error(`Could not find the package root for '${packageName}'.`);
        }
        dir = parent;
    }
}

/**
 * Whether a directory is the root of the named package.
 * @param dir - The directory to test.
 * @param packageName - The expected package name.
 * @returns True when the directory's package.json declares that name.
 */
function isPackageRoot(dir: string, packageName: string): boolean {
    try {
        const manifest: Record<string, unknown> = JSON.parse(
            readFileSync(join(dir, PACKAGE_MANIFEST), 'utf8')
        ) as Record<string, unknown>;
        return manifest['name'] === packageName;
    }
    catch {
        return false;
    }
}

/**
 * Picks the browser entry from a package manifest.
 * @param manifest - The parsed package.json.
 * @returns The relative entry path, or undefined when there is none.
 */
function resolveBrowserEntry(manifest: Record<string, unknown>): string | undefined {
    const exports: Record<string, unknown> | undefined = asRecord(manifest['exports']);
    if (exports) {
        return resolveFromExports(exports) ?? resolveFromTopLevelFields(manifest);
    }
    return resolveFromTopLevelFields(manifest);
}

/**
 * Picks the browser entry out of an exports map.
 * @param exports - The parsed exports map.
 * @returns The relative entry path, or undefined when there is none.
 */
function resolveFromExports(exports: Record<string, unknown>): string | undefined {
    const browser: unknown = asRecord(exports['.'])?.['browser'];
    if (typeof browser === 'string') {
        return stripLeadingDot(browser);
    }
    // Fall back to a directly exported flat dist bundle, e.g. "./dist/socket.io.js".
    for (const [key, value] of Object.entries(exports)) {
        if (typeof value === 'string' && /^\.\/dist\/.+\.js$/.test(key) && !key.includes('.min.')) {
            return stripLeadingDot(value);
        }
    }
    return undefined;
}

/**
 * Picks the browser entry out of the legacy top-level manifest fields.
 * @param manifest - The parsed package.json.
 * @returns The relative entry path, or undefined when there is none.
 */
function resolveFromTopLevelFields(manifest: Record<string, unknown>): string | undefined {
    for (const field of ['browser', 'unpkg', 'cdn']) {
        const value: unknown = manifest[field];
        if (typeof value === 'string') {
            return value;
        }
    }
    return undefined;
}

/**
 * Narrows a manifest value to a plain object.
 * @param value - The value to narrow.
 * @returns The value as a record, or undefined when it is not an object.
 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined;
}

/**
 * Removes the leading `./` from a manifest path so it can be joined onto the package directory.
 * @param path - The manifest path.
 * @returns The relative path.
 */
function stripLeadingDot(path: string): string {
    return path.replace(/^\.\//, '');
}