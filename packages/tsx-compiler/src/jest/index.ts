import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { resolveCompileError, resolveCompileWarning } from 'zibri-tsx/internal';

import { compile, CompileResult } from '../codegen/compile';
import { SourceMap } from '../codegen/source-map';
import { MarkdownCompilerUtilities } from '../markdown/markdown-compiler';
import { MarkdownKind } from '../markdown/markdown-printer.model';

/**
 * The subset of the options jest hands a transformer that this one uses. Typed structurally so the package needs
 * no jest dependency.
 */
export type TransformOptions = {
    /**
     * The jest configuration, serialized.
     */
    configString: string
};

/**
 * What the transformer returns for a file.
 */
export type TransformedSource = {
    /**
     * The compiled module.
     */
    code: string,
    /**
     * Its source map, leading back to the template, so a stack frame of a test names the template.
     */
    map: SourceMap
};

/**
 * A jest transformer.
 */
export type ZibriTsxTransformer = {
    /**
     * Compiles one template.
     */
    process: (source: string, file: string) => TransformedSource,
    /**
     * The key jest caches the compiled template under.
     */
    getCacheKey: (source: string, file: string, options: TransformOptions) => string
};

/**
 * The version of this package, read from beside the compiled file: `dist/jest` and `src/jest` both sit two levels
 * below the package root.
 * @returns The version.
 * @throws When the manifest has no version.
 */
function resolvePackageVersion(): string {
    const manifest: unknown = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
    if (typeof manifest !== 'object' || manifest == undefined || !('version' in manifest) || typeof manifest.version !== 'string') {
        throw new Error('zibri-tsx could not read its own version from its package.json.');
    }
    return manifest.version;
}

const PACKAGE_VERSION: string = resolvePackageVersion();

/**
 * A jest transformer that compiles a `.tsx`, `.md` or `.mdx` template the way the webpack loader does, so a test
 * renders the same components the build does.
 *
 * Register it for your template files ahead of the transformer for the rest of your code, like this.
 * ```js
 * transform: {
 *     '^.+[\\/]src[\\/]templates[\\/].+\\.(tsx|mdx?)$': 'zibri-tsx-compiler/jest',
 *     '^.+.tsx?$': ['ts-jest']
 * }
 * ```
 */
const zibriTsxTransformer: ZibriTsxTransformer = {
    process(source: string, file: string): TransformedSource {
        // commonjs, which is what jest runs a test in
        const kind: MarkdownKind | undefined = MarkdownCompilerUtilities.findMarkdownKind(file);
        const result: CompileResult = kind === undefined
            ? compile(source, { module: 'cjs', fileName: file })
            : MarkdownCompilerUtilities.compileMarkdown(source, kind, { module: 'cjs', fileName: file });
        if (!result.code || !result.map) {
            throw resolveCompileError(result.diagnostics, source, file);
        }
        if (result.diagnostics.length > 0) {
            // eslint-disable-next-line no-console
            console.warn(resolveCompileWarning(result.diagnostics, source, file).message);
        }
        return { code: result.code, map: result.map };
    },
    getCacheKey(source: string, file: string, options: TransformOptions): string {
        // jest's own key covers the file and the configuration, but not the transformer. Without the
        // version, a template compiled before an upgrade would keep being served from the cache. The
        // version stays the same while the compiler is worked on, and every build rewrites this file.
        return createHash('sha256')
            .update(source)
            .update(file)
            .update(options.configString)
            .update(PACKAGE_VERSION)
            .update(String(statSync(__filename).mtimeMs))
            // a markdown template is printed by the zibri-mdx of its project, which is installed on its own
            .update(MarkdownCompilerUtilities.findMarkdownKind(file) === undefined
                ? ''
                : MarkdownCompilerUtilities.resolvePrinterIdentity(file))
            .digest('hex');
    }
};

export default zibriTsxTransformer;