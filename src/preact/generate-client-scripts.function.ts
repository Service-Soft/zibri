import { createRequire } from 'node:module';

import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { toKebabCase } from '../utilities/to-kebab-case.function';

/**
 * Scans compiled JS files in srcDir for ?client imports, resolves their browser
 * distributions, and writes them to outputDir with predictable names.
 * Call this from your build plugin before compilation completes.
 * @example
 * // webpack plugin:
 * compiler.hooks.beforeCompile.tapPromise('ZibriClientScripts', () =>
 *     generateClientScripts({ srcDir: './dist', outputDir: './assets' })
 * );
 */
export async function generateClientScripts(): Promise<void> {
    const allPackages: Set<string> = new Set<string>();
    const packagesByComponent: Record<string, string[]> = {};
    const templateFiles: FsPath[] = await FsUtilities.glob('src/templates/**/*.tsx');

    await Promise.all(templateFiles.map(async f => {
        const src: string = await FsUtilities.readFile(f);
        const packages: string[] = extractClientPackages(src);
        if (!packages.length) {
            return;
        }
        const componentNames: string[] = extractComponentNames(src);
        for (const name of componentNames) {
            packagesByComponent[name] = [
                ...packagesByComponent[name] ?? [],
                ...packages
            ];
        }
        for (const pkg of packages) {
            allPackages.add(pkg);
        }
    }));

    const vendorPath: FsPath = FsUtilities.getPath('assets', 'public', 'vendor');
    await FsUtilities.mkdir(vendorPath);

    await Promise.all([...allPackages].map(async pkg => {
        const code: string = await resolveBrowserDist(pkg);
        const outFile: FsPath = FsUtilities.getPath(vendorPath, pkgToFilename(pkg));
        if (await FsUtilities.exists(outFile)) {
            const oldFileContent: string = await FsUtilities.readFile(outFile);
            if (oldFileContent.trim() === code.trim()) {
                return;
            }
        }
        await FsUtilities.upsertFile(outFile, code);
    }));

    const manifestFile: FsPath = FsUtilities.getPath(vendorPath, 'manifest.json');
    const sorted: Record<string, string[]> = Object.fromEntries(
        Object.entries(packagesByComponent).sort(([a], [b]) => a.localeCompare(b))
    );
    const newManifestContent: string = JSON.stringify(sorted, undefined, 4);
    if (await FsUtilities.exists(manifestFile)) {
        const oldFileContent: string = await FsUtilities.readFile(manifestFile);
        if (oldFileContent.trim() === newManifestContent.trim()) {
            return;
        }
    }
    await FsUtilities.upsertFile(manifestFile, newManifestContent);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function extractComponentNames(src: string): string[] {
    const names: string[] = [];
    // Matches: export const MyComponent = ... and export function MyComponent(
    const pattern: RegExp = /export\s+(?:const|function)\s+([$A-Z_a-z]\w*)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
        names.push(match[1]);
    }
    return names;
}

// eslint-disable-next-line jsdoc/require-jsdoc
function extractClientPackages(src: string): string[] {
    const packages: string[] = [];
    const pattern: RegExp = /from\s*["']([^"']+)\?client["']/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(src)) !== null) {
        packages.push(match[1]);
    }
    return packages;
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function resolveBrowserDist(pkg: string): Promise<string> {
    // eslint-disable-next-line sonar/no-duplicate-string
    const userRequire: NodeJS.Require = createRequire(FsUtilities.getPath(process.cwd(), 'package.json'));
    const pkgDir: string = await findPackageDir(pkg, userRequire);
    // eslint-disable-next-line typescript/no-unsafe-assignment
    const pkgJson: Record<string, unknown> = JSON.parse(await FsUtilities.readFile(FsUtilities.getPath(pkgDir, 'package.json')));

    const browserEntry: string | undefined = resolveBrowserEntry(pkgJson);
    if (!browserEntry) {
        throw new Error(
            `[zibri] Package '${pkg}' has no browser distribution. `
            + 'It must expose a browser build via \'browser\', \'unpkg\', \'cdn\', or exports[\'browser\'] in package.json.'
        );
    }
    return await FsUtilities.readFile(FsUtilities.getPath(pkgDir, browserEntry));
}

// eslint-disable-next-line jsdoc/require-jsdoc
async function findPackageDir(pkg: string, userRequire: NodeJS.Require): Promise<string> {
    // Fast path — most packages allow this
    try {
        return FsUtilities.dirName(FsUtilities.getPath(userRequire.resolve(`${pkg}/package.json`)));
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') {
            throw error;
        }
    }

    // Fallback — resolve main entry and walk up to find the package root
    const main: FsPath = FsUtilities.getPath(userRequire.resolve(pkg));
    let dir: string = FsUtilities.dirName(main);
    while (true) {
        const candidate: FsPath = FsUtilities.getPath(dir, 'package.json');
        try {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const json: Record<string, unknown> = JSON.parse(await FsUtilities.readFile(candidate));
            if (json['name'] === pkg) {
                return dir;
            }
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw error;
            }
        }
        const parent: string = FsUtilities.dirName(FsUtilities.getPath(dir));
        if (parent === dir) {
            throw new Error(`[zibri] Could not find package root for '${pkg}'`);
        }
        dir = parent;
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc, sonar/cognitive-complexity
function resolveBrowserEntry(pkgJson: Record<string, unknown>): string | undefined {
    // 1. Modern exports map: { ".": { "browser": "./dist/..." } }
    const exports: unknown = pkgJson['exports'];
    if (typeof exports === 'object' && exports !== null) {
        const exportsMap: Record<string, unknown> = exports as Record<string, unknown>;

        // Check exports['.']['browser']
        const root: unknown = exportsMap['.'];
        if (typeof root === 'object' && root !== null) {
            const browser: unknown = (root as Record<string, unknown>)['browser'];
            if (typeof browser === 'string') {
                return browser.replace(/^\.\//, '');
            }
        }

        // Scan for directly exported flat bundle files: "./dist/socket.io.js": "./dist/socket.io.js"
        const distExports: string[] = [];
        for (const [key, val] of Object.entries(exportsMap)) {
            if (key === '.' || key === './package.json') {
                continue;
            }
            if (typeof val === 'string' && /^\.\/dist\/.+\.js$/.test(key) && !key.includes('.min.')) {
                distExports.push(val.replace(/^\.\//, ''));
            }
        }
        if (distExports.length) {
            return distExports[0];
        }
    }

    // 2. Legacy string fields — skip objects (module path maps, not a single file)
    for (const field of ['browser', 'unpkg', 'cdn'] as const) {
        const val: unknown = pkgJson[field];
        if (typeof val === 'string') {
            return val;
        }
    }

    return undefined;
}

/**
 * Resolves the given package name to a valid file name.
 * @param pkg - The package to resolve the file name for.
 * @returns The package name in kebab case with .js at the end.
 */
export function pkgToFilename(pkg: string): string {
    return `${toKebabCase(pkg)}.js`;
}