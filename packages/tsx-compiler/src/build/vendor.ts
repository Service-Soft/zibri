import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import ts from 'typescript';
import { vendorFileName } from 'zibri-tsx/internal';

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
 * Resolves the code of a package's vendor bundle, as {@link generateVendorBundles} writes it, without
 * writing anything. A test serves it to a browser this way, so it needs no build first.
 * @param packageName - The `?client` package name, such as `chart.js`.
 * @param resolveFrom - The directory whose `package.json` anchors module resolution, normally the application root.
 * @returns The bundle's code.
 * @throws When the package has no browser distribution to serve.
 */
export async function resolveVendorBundleCode(packageName: string, resolveFrom: string): Promise<string> {
    return await readBrowserDist(packageName, createRequire(join(resolveFrom, PACKAGE_MANIFEST)));
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
 * Reads a package's browser distribution bundle: the first of the browser entries its manifest
 * names that is a classic script.
 *
 * The page loads the file with a classic script tag, so the contract is a global - and a browser
 * entry that is an ES module is a file every browser refuses. Many packages name a module as their
 * `exports['.'].browser` and keep a UMD build under `unpkg` or `browser`, which is the one to serve.
 * @param packageName - The package to resolve.
 * @param require - A require anchored at the application root.
 * @returns The bundle source.
 * @throws When the package exposes no browser distribution, or only ES modules.
 */
async function readBrowserDist(packageName: string, require: NodeJS.Require): Promise<string> {
    const packageDir: string = findPackageDir(packageName, require);
    const manifest: Record<string, unknown> = JSON.parse(
        await readFile(join(packageDir, PACKAGE_MANIFEST), 'utf8')
    ) as Record<string, unknown>;

    const entries: string[] = resolveBrowserEntries(manifest);
    if (entries.length === 0) {
        throw new Error(
            `Package '${packageName}' has no browser distribution. It must expose one via `
            + '\'browser\', \'unpkg\', \'cdn\', or exports[\'browser\'] in its package.json.'
        );
    }
    for (const entry of entries) {
        const code: string = await readFile(join(packageDir, entry), 'utf8');
        if (!isEsModule(entry, code)) {
            return code;
        }
    }
    throw new Error(
        `Package '${packageName}' ships its browser distribution as an ES module (${entries.join(', ')}), `
        + 'which a page loads with a classic script tag and no browser runs. A \'?client\' package has to '
        + 'provide a classic script that sets a global, such as a UMD or IIFE build; import it from a '
        + 'package that does, or bundle the module into one yourself.'
    );
}

/**
 * Whether a browser entry is an ES module rather than a classic script.
 *
 * Decided by the extension where it says so, a `.mjs` file is a module and a `.cjs` file is not,
 * and by the code otherwise: a static `import` or `export` statement at the top level is what only
 * a module can hold. The manifest's `"type"` says nothing here: a UMD build is a classic script in
 * a `"type": "module"` package as much as in any other, and the browser never reads the manifest.
 * @param entry - The entry's path inside the package.
 * @param code - The entry's content.
 * @returns True for an ES module.
 */
function isEsModule(entry: string, code: string): boolean {
    if (entry.endsWith('.mjs')) {
        return true;
    }
    if (entry.endsWith('.cjs')) {
        return false;
    }
    // parsed rather than searched: a minified build holds the words in its strings ("Please import
    // and register the plugin"), and only the parser knows a statement from a string
    const sourceFile: ts.SourceFile = ts.createSourceFile(entry, code, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
    return sourceFile.statements.some(statement => ts.isImportDeclaration(statement)
        || ts.isExportDeclaration(statement)
        || ts.isExportAssignment(statement)
        || (ts.canHaveModifiers(statement)
            && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) === true));
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
 * The browser entries a package manifest names, most specific first and without repeats.
 * @param manifest - The parsed package.json.
 * @returns The relative entry paths, empty when there is none.
 */
function resolveBrowserEntries(manifest: Record<string, unknown>): string[] {
    const exports: Record<string, unknown> | undefined = asRecord(manifest['exports']);
    const entries: string[] = [...exports ? resolveFromExports(exports) : [], ...resolveFromTopLevelFields(manifest)];
    return entries.filter((entry, index) => entries.indexOf(entry) === index);
}

/**
 * The browser entries an exports map names.
 * @param exports - The parsed exports map.
 * @returns The relative entry paths.
 */
function resolveFromExports(exports: Record<string, unknown>): string[] {
    const entries: string[] = [];
    const browser: unknown = asRecord(exports['.'])?.['browser'];
    if (typeof browser === 'string') {
        entries.push(stripLeadingDot(browser));
    }
    // and any directly exported flat dist bundle, e.g. "./dist/socket.io.js".
    for (const [key, value] of Object.entries(exports)) {
        if (typeof value === 'string' && /^\.\/dist\/.+\.js$/.test(key) && !key.includes('.min.')) {
            entries.push(stripLeadingDot(value));
        }
    }
    return entries;
}

/**
 * The browser entries the legacy top-level manifest fields name.
 * @param manifest - The parsed package.json.
 * @returns The relative entry paths.
 */
function resolveFromTopLevelFields(manifest: Record<string, unknown>): string[] {
    return ['browser', 'unpkg', 'cdn']
        .map(field => manifest[field])
        .filter((value): value is string => typeof value === 'string')
        .map(value => stripLeadingDot(value));
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