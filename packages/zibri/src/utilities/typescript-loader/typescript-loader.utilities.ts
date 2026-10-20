import { readFileSync } from 'node:fs';
import { createRequire, registerHooks, setSourceMapsSupport, type LoadFnOutput, type LoadHookContext, type ResolveFnOutput, type ResolveHookContext } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFunction } from 'node:vm';

import type { OxcError, TransformResult, transformSync } from 'oxc-transform';

import { InternalError } from '../../error-handling/internal-error.model.ts';

// This file and everything it imports are loaded by node's own type stripping wherever the loader
// has to be in place before any other TypeScript runs, such as a test cluster instance started from
// the sources. So: node builtins, type only imports written as such, and no syntax that only
// TypeScript has - no enums, no parameter properties, no decorators.

/**
 * The module format of a compiled file.
 */
type CompiledFormat = 'module' | 'commonjs';

/**
 * A file compiled to JavaScript, and the format node is told it has.
 */
type CompiledFile = {
    /**
     * The format of the compiled code.
     */
    format: CompiledFormat,
    /**
     * What the compiler made of the file.
     */
    result: TransformResult
};

/**
 * The function of `oxc-transform` that does the work.
 */
type TransformSync = typeof transformSync;

/**
 * Node's own `require`, which resolves the compiler from where this package is installed.
 */
const nodeRequire: NodeJS.Require = createRequire(import.meta.url);

/**
 * The extensions of the files the loader compiles.
 */
const TYPESCRIPT_EXTENSIONS: string[] = ['.ts', '.mts', '.cts'];

/**
 * The runtime helpers the compiled code imports, by the specifier it imports them under, served
 * from the files beside this one.
 */
const HELPER_FILES: Record<string, string> = {
    '@oxc-project/runtime/helpers/decorate': 'decorate.function',
    '@oxc-project/runtime/helpers/decorateMetadata': 'decorate-metadata.function',
    '@oxc-project/runtime/helpers/decorateParam': 'decorate-param.function'
};

/**
 * The extension of this file, which the helpers beside it share: `.ts` in the sources, `.js` once built.
 */
const OWN_EXTENSION: string = path.extname(import.meta.filename);

/**
 * Loads TypeScript files without building them first: compiled as they are loaded, with the legacy
 * decorators and the decorator metadata the framework reads.
 */
export abstract class TypeScriptLoaderUtilities {
    /**
     * Whether the loader is registered in this thread.
     */
    private static registered: boolean = false;

    /**
     * Registers the loader in the current thread, so a TypeScript file can be loaded through
     * `import` and `require` alike. Registering again does nothing.
     *
     * Lazily, and never on its own account. A production image runs compiled JavaScript, and a
     * framework that pulls a compiler into it is carrying a build tool through container hardening
     * review for a capability that image will never use. Registering at the moment a TypeScript file
     * is actually named means the cost is paid by the deployments that asked for it.
     * @param reason - What is being loaded, so a consumer without the compiler is told why it was needed.
     * @throws If the optional peer dependency `oxc-transform` is not installed.
     */
    static register(reason: string): void {
        if (this.registered) {
            return;
        }
        const transform: TransformSync = this.resolveTransformSync(reason);
        // stack traces then point into the TypeScript file rather than into what it was compiled to
        setSourceMapsSupport(true);
        registerHooks({
            resolve: (specifier, context, nextResolve) => this.resolveHelper(specifier, context, nextResolve),
            load: (url, context, nextLoad) => this.load(transform, url, context, nextLoad)
        });
        this.registered = true;
    }

    /**
     * Whether the compiler could be loaded, without loading it.
     *
     * Resolution only, so this answers the question a startup check asks - is the optional peer
     * dependency there - without paying for the compiler in the process that asked.
     * @returns True if `oxc-transform` is installed.
     */
    static isInstalled(): boolean {
        try {
            nodeRequire.resolve('oxc-transform');
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * The file this class is declared in, for a process that has to register the loader before it
     * loads anything else: it loads this file by path and calls {@link register}. This file loads
     * without being compiled first, through node's own type stripping, even in the sources.
     * @returns The absolute path.
     */
    static getModuleFile(): string {
        return import.meta.filename;
    }

    /**
     * Whether loading this file needs the loader.
     * @param filePath - The file about to be loaded.
     * @returns True for a TypeScript file.
     */
    static isNeededFor(filePath: string): boolean {
        return TYPESCRIPT_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
    }

    /**
     * Loads the compiler.
     *
     * Through `require` rather than an import: an import is resolved when this module loads, which
     * would make an optional peer dependency mandatory again by the back door.
     * @param reason - What is being loaded, for the error.
     * @returns The compiler.
     * @throws If `oxc-transform` is not installed.
     */
    private static resolveTransformSync(reason: string): TransformSync {
        try {
            // oxlint-disable-next-line jsdoc-js/require-jsdoc
            const oxc: { transformSync: TransformSync } = nodeRequire('oxc-transform') as { transformSync: TransformSync };
            return oxc.transformSync;
        }
        catch (error) {
            throw new InternalError(
                `${reason} is TypeScript, which needs the optional peer dependency "oxc-transform" to be installed.`
                + ' Install it, or point this at the compiled JavaScript instead.',
                { cause: error }
            );
        }
    }

    /**
     * Points the runtime helpers the compiled code imports at the files beside this one.
     * @param specifier - What is being imported.
     * @param context - Where from.
     * @param nextResolve - Node's own resolution, for everything else.
     * @returns Where the import resolves to.
     */
    private static resolveHelper(
        specifier: string,
        context: ResolveHookContext,
        nextResolve: (specifier: string, context?: Partial<ResolveHookContext>) => ResolveFnOutput
    ): ResolveFnOutput {
        const helper: string | undefined = HELPER_FILES[specifier];
        if (helper == undefined) {
            return nextResolve(specifier, context);
        }
        return {
            url: new URL(`./${helper}${OWN_EXTENSION}`, import.meta.url).href,
            format: 'module',
            shortCircuit: true
        };
    }

    /**
     * Compiles a TypeScript file as it is loaded, and leaves every other file to node.
     * @param transform - The compiler.
     * @param url - The file being loaded.
     * @param context - What node already knows about it.
     * @param nextLoad - Node's own loading, for everything else.
     * @returns The compiled module.
     * @throws If the file does not compile, or the compiled code needs a helper the loader does not serve.
     */
    private static load(
        transform: TransformSync,
        url: string,
        context: LoadHookContext,
        nextLoad: (url: string, context?: Partial<LoadHookContext>) => LoadFnOutput
    ): LoadFnOutput {
        if (!this.isCompiled(url)) {
            return nextLoad(url, context);
        }
        const filePath: string = fileURLToPath(url);
        const source: string = readFileSync(filePath, 'utf8');
        const format: CompiledFormat | undefined = this.resolveFormat(context.format);
        const compiled: CompiledFile = format == undefined
            ? this.compileDetectingFormat(transform, filePath, source)
            : { format, result: this.compile(transform, filePath, source, format) };

        const errors: OxcError[] = this.findErrors(compiled.result);
        if (errors.length) {
            throw new InternalError([`${filePath} could not be compiled:`, ...errors.map(error => error.codeframe ?? error.message)]);
        }
        const unserved: string[] = Object.values(compiled.result.helpersUsed).filter(specifier => HELPER_FILES[specifier] == undefined);
        if (unserved.length) {
            throw new InternalError(`${filePath} compiled to code that needs the runtime helpers ${unserved.join(', ')}, which the loader does not serve.`);
        }

        const sourceMap: string = Buffer.from(JSON.stringify(compiled.result.map)).toString('base64');
        return {
            format: compiled.format,
            source: `${compiled.result.code}\n//# sourceMappingURL=data:application/json;base64,${sourceMap}`,
            shortCircuit: true
        };
    }

    /**
     * Compiles a file of a package without a `"type"`, where node decides the format by the syntax:
     * commonjs, unless the file only parses as a module.
     *
     * Decided here rather than left to node: its own detection strips the types first, which fails
     * on decorators, and `import` refuses a file whose format it was not told.
     * @param transform - The compiler.
     * @param filePath - The file.
     * @param source - Its content.
     * @returns The compiled file.
     */
    private static compileDetectingFormat(transform: TransformSync, filePath: string, source: string): CompiledFile {
        const asCommonjs: TransformResult = this.compile(transform, filePath, source, 'commonjs');
        // the compiler refuses `import.meta` and a top level `await` outside a module, but lets
        // `import` and `export` through - so the compiled code is also asked the way node asks it,
        // by compiling it as the function a commonjs module is wrapped in
        if (!this.findErrors(asCommonjs).length && this.isCommonjsSyntax(asCommonjs.code)) {
            return { format: 'commonjs', result: asCommonjs };
        }
        // a file that does not parse either way reports what is wrong with it as a module
        return { format: 'module', result: this.compile(transform, filePath, source, 'module') };
    }

    /**
     * Whether compiled code parses as the body of a commonjs module.
     * @param code - The compiled code.
     * @returns False when it uses syntax only a module may.
     */
    private static isCommonjsSyntax(code: string): boolean {
        try {
            compileFunction(code, ['exports', 'require', 'module', '__filename', '__dirname']);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Compiles one file, with the legacy decorators and the decorator metadata the framework reads.
     * @param transform - The compiler.
     * @param filePath - The file.
     * @param source - Its content.
     * @param format - What to parse it as.
     * @returns What the compiler made of it.
     */
    private static compile(transform: TransformSync, filePath: string, source: string, format: CompiledFormat): TransformResult {
        return transform(filePath, source, {
            lang: 'ts',
            sourceType: format,
            decorator: { legacy: true, emitDecoratorMetadata: true },
            sourcemap: true
        });
    }

    /**
     * The errors among what the compiler reported, as opposed to its warnings.
     * @param result - What the compiler made of a file.
     * @returns The errors.
     */
    private static findErrors(result: TransformResult): OxcError[] {
        return result.errors.filter(error => error.severity === 'Error');
    }

    /**
     * Whether a url names a file the loader compiles.
     *
     * A package's own files are left to node, as they are a dependency's to ship compiled.
     * @param url - The url being loaded, query and all.
     * @returns True for a TypeScript file outside `node_modules`.
     */
    private static isCompiled(url: string): boolean {
        if (!url.startsWith('file:')) {
            return false;
        }
        const pathname: string = new URL(url).pathname;
        return this.isNeededFor(pathname) && !pathname.includes('/node_modules/');
    }

    /**
     * The format of the compiled file: the one node itself settled on for the TypeScript file, from
     * its extension and the nearest `package.json`.
     * @param format - What node resolved the file's format to.
     * @returns The format of the compiled file, or undefined in a package without a `"type"`.
     */
    private static resolveFormat(format: string | null | undefined): CompiledFormat | undefined {
        switch (format) {
            case 'module':
            case 'module-typescript': {
                return 'module';
            }
            case 'commonjs':
            case 'commonjs-typescript': {
                return 'commonjs';
            }
            case undefined:
            // oxlint-disable-next-line unicorn/no-null
            case null:
            default: {
                return undefined;
            }
        }
    }
}
