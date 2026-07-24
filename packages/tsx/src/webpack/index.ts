import { collectClientPackagesFromFiles, findTemplateFiles } from '../build/templates';
import { generateVendorBundles } from '../build/vendor';
import { compile, CompileResult, ModuleFormat } from '../codegen/compile';
import { Diagnostic, offsetToLineColumn } from '../diagnostics/diagnostic.model';

/**
 * The subset of webpack's loader context this loader uses. Typed structurally so the package needs
 * no webpack dependency.
 */
export type LoaderContext = {
    /**
     * The file being compiled.
     */
    resourcePath: string,
    /**
     * Reports a compilation error for this file.
     */
    emitError: (error: Error) => void,
    /**
     * Reads the options the loader was configured with.
     */
    getOptions?: () => LoaderOptions
};

/**
 * Options the loader accepts.
 */
export type LoaderOptions = {
    /**
     * The module format the compiled templates are emitted as. Defaults to `cjs`, which is what a
     * bundled node app is, and what keeps a dual package like zibri from being pulled in twice.
     */
    module?: ModuleFormat
};

/**
 * The subset of webpack's compiler this plugin uses.
 */
export type CompilerLike = {
    /**
     * The compiler hooks.
     */
    hooks: {
        /**
         * Runs before each compilation.
         */
        beforeCompile: {
            /**
             * Taps an async handler.
             */
            tapPromise: (name: string, fn: () => Promise<unknown>) => void
        }
    }
};

/**
 * Formats diagnostics into a single readable error for the bundler.
 * @param diagnostics - The diagnostics to format.
 * @param source - The source they refer to.
 * @param file - The file path, for context.
 * @returns The error to report.
 */
function toError(diagnostics: Diagnostic[], source: string, file: string): Error {
    const lines: string[] = diagnostics.map(diagnostic => {
        const { line, column } = offsetToLineColumn(source, diagnostic.span.start);
        return `${file}:${line}:${column} ${diagnostic.code} ${diagnostic.message}`;
    });
    return new Error(`zibri-tsx failed to compile:\n${lines.join('\n')}`);
}

/**
 * A webpack loader that compiles a `.tsx` template into a compiled-component module.
 *
 * Register it for your template files, like this.
 * ```js
 * { test: /\.tsx$/, include: /src[\\/]templates/, use: 'zibri-tsx/webpack' }
 * ```
 * @param this - The webpack loader context.
 * @param source - The template source.
 * @returns The emitted module, or an empty module when compilation failed.
 */
export default function zibriTsxLoader(this: LoaderContext, source: string): string {
    const format: ModuleFormat = this.getOptions?.().module ?? 'cjs';
    const result: CompileResult = compile(source, { module: format });
    if (!result.code) {
        this.emitError(toError(result.diagnostics, source, this.resourcePath));
        return format === 'cjs' ? 'module.exports = undefined;' : 'export default undefined;';
    }
    return result.code;
}

/**
 * Options for {@link ZibriTsxVendorPlugin}.
 */
export type VendorPluginOptions = {
    /**
     * Directories to scan for templates that may carry `?client` imports.
     */
    templateDirs: string[],
    /**
     * Directory the vendor bundles are written to (served under the matching URL prefix).
     */
    outDir: string,
    /**
     * Directory whose `package.json` anchors resolution — usually the application root.
     */
    resolveFrom?: string
};

/**
 * A webpack plugin that writes the browser bundles for every `?client` package the templates import,
 * so the generated client scripts find those packages as globals.
 *
 * Unlike the manifest-based predecessor, nothing is emitted for the runtime to look up: each compiled
 * component records its own `?client` packages, and `renderPage` derives the `<script src>` tags from
 * the components it actually rendered.
 */
export class ZibriTsxVendorPlugin {
    constructor(private readonly options: VendorPluginOptions) {}

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: CompilerLike): void {
        compiler.hooks.beforeCompile.tapPromise('ZibriTsxVendorPlugin', async () => {
            const files: string[] = findTemplateFiles(this.options.templateDirs);
            const packages: string[] = collectClientPackagesFromFiles(files);
            await generateVendorBundles({
                packages,
                outDir: this.options.outDir,
                resolveFrom: this.options.resolveFrom ?? process.cwd()
            });
        });
    }
}