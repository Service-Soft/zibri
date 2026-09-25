import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { compile, CompileResult } from '../codegen/compile';
import { resolveCompileError } from '../diagnostics/diagnostic.model';

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
    code: string
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
 * A jest transformer that compiles a `.tsx` template the way the webpack loader does, so a test renders the
 * same components the build does.
 *
 * Register it for your template files ahead of the transformer for the rest of your code, like this.
 * ```js
 * transform: {
 *     '^.+[\\/]src[\\/]templates[\\/].+\\.tsx$': 'zibri-tsx/jest',
 *     '^.+.tsx?$': ['ts-jest']
 * }
 * ```
 */
const zibriTsxTransformer: ZibriTsxTransformer = {
    process(source: string, file: string): TransformedSource {
        // commonjs, which is what jest runs a test in
        const result: CompileResult = compile(source, { module: 'cjs' });
        if (!result.code) {
            throw resolveCompileError(result.diagnostics, source, file);
        }
        return { code: result.code };
    },
    getCacheKey(source: string, file: string, options: TransformOptions): string {
        // jest's own key covers the file and the configuration, but not the transformer. Without the
        // version, a template compiled before an upgrade would keep being served from the cache
        return createHash('sha256')
            .update(source)
            .update(file)
            .update(options.configString)
            .update(PACKAGE_VERSION)
            .digest('hex');
    }
};

export default zibriTsxTransformer;