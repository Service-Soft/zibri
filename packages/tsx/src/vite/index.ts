import path from 'node:path';

import type { CompileResult } from '../codegen/compile.ts';
import { resolveCompileError } from '../diagnostics/diagnostic.model.ts';

const CLIENT_QUERY: string = '?client';

/**
 * The package the compiler takes TypeScript's parser from, an optional peer dependency.
 */
const TYPESCRIPT_PACKAGE: string = '@typescript/typescript6';

/**
 * The compiler entry point.
 */
type CompilerModule = typeof import('../compiler.ts');

/**
 * Options for {@link zibriTsx}.
 */
export type ZibriTsxPluginOptions = {
    /**
     * Directories holding the templates. Every `.tsx` file in them is compiled by zibri-tsx.
     */
    templateDirs: string[],
    /**
     * Directory the browser bundles of the `?client` packages are written to, served under the
     * matching URL prefix.
     */
    vendorOutDir: string
};

/**
 * A module as Vite resolved it. Typed structurally, like everything else Vite hands this plugin, so
 * the package needs no vite dependency.
 */
export type ResolvedModule = {
    /**
     * The resolved id.
     */
    id: string,
    /**
     * Whether the module stays outside the bundle.
     */
    external: boolean | 'absolute'
};

/**
 * The subset of the context Vite calls a hook in that this plugin uses.
 */
export type PluginContext = {
    /**
     * Resolves a module the way the rest of the build does.
     */
    resolve: (source: string, importer?: string, options?: { /**
     *
     */
    skipSelf?: boolean }) => Promise<ResolvedModule | null>,
    /**
     * Fails the build with the given error.
     */
    error: (error: Error) => never
};

/**
 * A compiled module.
 */
export type TransformedModule = {
    /**
     * The emitted code.
     */
    code: string,
    /**
     * The source map, of which a compiled template has none.
     */
    map: null
};

/**
 * The subset of a Vite plugin this package fills in.
 */
export type ZibriTsxPlugin = {
    /**
     * The plugin's name, shown in warnings and errors.
     */
    name: string,
    /**
     * Runs the plugin before Vite's own transforms, which would otherwise compile the templates as react tsx.
     */
    enforce?: 'pre',
    /**
     * Limits the plugin to `vite build`, so neither the dev server nor a test run writes files.
     */
    apply?: 'build',
    /**
     * Receives the resolved configuration.
     */
    configResolved?: (config: { /**
     *
     */
    root: string }) => void,
    /**
     * Resolves a module id.
     */
    resolveId?: (this: PluginContext, source: string, importer: string | undefined) => Promise<ResolvedModule | undefined>,
    /**
     * Compiles a module.
     */
    transform?: (this: PluginContext, code: string, id: string) => Promise<TransformedModule | undefined>,
    /**
     * Runs as each build starts.
     */
    buildStart?: () => Promise<void>
};

/**
 * The Vite plugin that compiles `.tsx` templates with zibri-tsx. It serves `vite build` and vitest alike, so a
 * test renders the same components the build does.
 *
 * Besides the templates, it resolves a package imported with `?client` to the package itself on the server, and
 * writes the browser bundles of those packages at the start of each build, so the generated client scripts find
 * them as globals.
 *
 * Add it to your Vite configuration, like this.
 * ```ts
 * plugins: [zibriTsx({ templateDirs: [path.resolve('src', 'templates')], vendorOutDir: path.resolve('assets', 'public', 'vendor') })]
 * ```
 * @param options - Where the templates are, and where the vendor bundles go.
 * @returns The plugins to add.
 */
export function zibriTsx(options: ZibriTsxPluginOptions): ZibriTsxPlugin[] {
    let root: string = process.cwd();
    return [
        {
            name: 'zibri-tsx',
            enforce: 'pre',
            async resolveId(source: string, importer: string | undefined): Promise<ResolvedModule | undefined> {
                if (!source.endsWith(CLIENT_QUERY)) {
                    return undefined;
                }
                // the browser gets the package as a global from its vendor bundle, and the compiled templates
                // drop the import. Any other module importing it runs on the server, where it is the package
                const resolved: ResolvedModule | null = await this.resolve(source.slice(0, -CLIENT_QUERY.length), importer, { skipSelf: true });
                return resolved ?? undefined;
            },
            async transform(code: string, id: string): Promise<TransformedModule | undefined> {
                // a module id carries Vite's query, if any, after the path
                const file: string = id.split('?')[0];
                if (!file.endsWith('.tsx') || !isWithin(file, options.templateDirs)) {
                    return undefined;
                }
                const { compile } = await resolveCompiler();
                const result: CompileResult = compile(code, { module: 'esm' });
                if (result.code == undefined) {
                    return this.error(resolveCompileError(result.diagnostics, code, file));
                }
                return { code: result.code, map: null };
            }
        },
        {
            name: 'zibri-tsx:vendor',
            apply: 'build',
            configResolved(config: { /**
             *
             */
            root: string }): void {
                root = config.root;
            },
            async buildStart(): Promise<void> {
                const { collectClientPackagesFromFiles, findTemplateFiles, generateVendorBundles } = await resolveCompiler();
                const files: string[] = findTemplateFiles(options.templateDirs);
                await generateVendorBundles({
                    packages: collectClientPackagesFromFiles(files),
                    outDir: options.vendorOutDir,
                    resolveFrom: root
                });
            }
        }
    ];
}

/**
 * Loads the compiler. It is loaded on first use rather than imported, because it needs TypeScript's parser,
 * an optional peer dependency, and an import would fail with a message that does not say what to install.
 * @returns The compiler.
 * @throws When TypeScript's parser is not installed, naming the package to install.
 */
async function resolveCompiler(): Promise<CompilerModule> {
    try {
        return await import('../compiler.ts');
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes(TYPESCRIPT_PACKAGE)) {
            throw new Error(
                `zibri-tsx compiles templates with TypeScript's parser from '${TYPESCRIPT_PACKAGE}', which is not installed. `
                + `Add it as a dev dependency: npm install --save-dev ${TYPESCRIPT_PACKAGE}`
            );
        }
        throw error;
    }
}

/**
 * Whether a file lies inside one of the given directories.
 * @param file - The file.
 * @param dirs - The directories.
 * @returns True when one of them contains the file.
 */
function isWithin(file: string, dirs: string[]): boolean {
    return dirs.some(dir => {
        const relative: string = path.relative(path.resolve(dir), path.resolve(file));
        return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
    });
}
