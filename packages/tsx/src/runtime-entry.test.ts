import { execFileSync, spawnSync, SpawnSyncReturns } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import ts from 'typescript';

import packageJson from '../package.json';

/**
 * The built package, which is the only thing that can answer this question.
 *
 * Whether an import survives to the emitted file is the whole point, so the source tree says
 * nothing about it - and module resolution is process-wide, so the check runs in a child.
 */
const distPath: string = join(__dirname, '..', 'dist');

/**
 * Loads one built entry point with `typescript` hidden from module resolution.
 * @param entry - The entry file, relative to `dist`.
 * @returns What the child reported: the loaded exports it was asked about, or the failure.
 */
function loadWithoutTypescript(entry: string): { loaded: boolean, message: string } {
    const script: string = `
        const Module = require('node:module');
        const resolve = Module._resolveFilename;
        Module._resolveFilename = function (request, ...rest) {
            if (request === 'typescript') {
                throw new Error('resolved typescript');
            }
            return resolve.call(this, request, ...rest);
        };
        try {
            const loaded = require(${JSON.stringify(join(distPath, entry))});
            process.stdout.write(JSON.stringify({
                loaded: true,
                message: '',
                keys: Object.keys(loaded)
            }));
        }
        catch (error) {
            process.stdout.write(JSON.stringify({ loaded: false, message: error.message, keys: [] }));
        }
    `;
    const output: string = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
    return JSON.parse(output) as { loaded: boolean, message: string, keys: string[] };
}

/**
 * The source files of the entry points: the main one, which re-exports the email one, and the internal one.
 */
const ENTRY_POINTS: { main: string, email: string, internal: string } = {
    main: join(__dirname, 'index.ts'),
    email: join(__dirname, 'email', 'index.ts'),
    internal: join(__dirname, 'internal.ts')
};

/**
 * What 3.0 exported from `zibri-tsx`, its email components among them, that `zibri-tsx/internal` holds since.
 */
// TODO 4.0: remove with the forwarded names
const MOVED_TO_INTERNAL_AFTER_3_0: readonly string[] = [
    'Defaults',
    'defineEmailComponent',
    'documentDefaults',
    'EmailProps',
    'EmailRender',
    'HeadChannel',
    'HeadChannels',
    'horizontalPadding',
    'LineColumn',
    'offsetToLineColumn',
    'PaddingSides',
    'pixels',
    'resolveCompileError',
    'resolvePadding',
    'withDefaults',
    'AccessShape',
    'AllPropsExcept',
    'attr',
    'buildClientScript',
    'buildVendorTags',
    'CLIENT_HOOK_SOURCES',
    'ClientInstanceEntry',
    'ClientPropMarker',
    'ClientPropRegistryEntry',
    'CompiledComponent',
    'ComponentClientMeta',
    'createServerRuntime',
    'decodeJsxEntities',
    'FieldAccess',
    'HandlerMarker',
    'HandlerRegistryEntry',
    'HandlerSpec',
    'HookData',
    'HOOK_PLACEHOLDERS',
    'isClientPropMarker',
    'isScriptUrl',
    'MarkerHandlerSpec',
    'mergeAccessShapes',
    'NewHandlerSpec',
    'normalizeJsxText',
    'projectValue',
    'REATTACH_RUNTIME',
    'ReferencedProps',
    'renderChild',
    'RenderServerRuntime',
    'renderStyle',
    'resolveAccessThroughRest',
    'resolveReferencedKeys',
    'SERVER_HOOKS',
    'ServerHooks',
    'serverRuntime',
    'ServerRuntime',
    'SETUP_RUNTIME_PARAM',
    'spreadAttributes',
    'substituteHookPlaceholders',
    'vendorFileName',
    'VOID_ELEMENTS',
    'wrapDocument'
];

/**
 * The options the package's sources are checked with.
 * @returns The options of tsconfig.json.
 */
function resolveCompilerOptions(): ts.CompilerOptions {
    const configPath: string = join(__dirname, '..', 'tsconfig.json');
    const config: { config?: unknown } = ts.readConfigFile(configPath, path => ts.sys.readFile(path));
    return ts.parseJsonConfigFileContent(config.config, ts.sys, join(__dirname, '..')).options;
}

/**
 * The names a module of the program exports.
 * @param program - The program holding the module.
 * @param checker - The checker of the program.
 * @param fileName - The module's file.
 * @returns Its exports.
 * @throws When the file is no module of the program.
 */
function resolveExports(program: ts.Program, checker: ts.TypeChecker, fileName: string): ts.Symbol[] {
    const source: ts.SourceFile | undefined = program.getSourceFile(fileName);
    const module: ts.Symbol | undefined = source === undefined ? undefined : checker.getSymbolAtLocation(source);
    if (module === undefined) {
        throw new Error(`${fileName} is no module of the program.`);
    }
    return checker.getExportsOfModule(module);
}

/**
 * The files the entry points re-export from, besides each other.
 * @param program - The program holding the entry points.
 * @param checker - The checker of the program.
 * @returns Their file names.
 */
function resolveReexportedFiles(program: ts.Program, checker: ts.TypeChecker): string[] {
    const entries: string[] = [ENTRY_POINTS.main, ENTRY_POINTS.email, ENTRY_POINTS.internal];
    return entries
        .flatMap(entry => program.getSourceFile(entry)?.statements ?? [])
        .filter(ts.isExportDeclaration)
        .flatMap(statement => {
            const module: ts.Symbol | undefined = statement.moduleSpecifier === undefined
                ? undefined
                : checker.getSymbolAtLocation(statement.moduleSpecifier);
            return (module?.declarations ?? []).filter(ts.isSourceFile).map(file => file.fileName);
        })
        .filter(fileName => !entries.includes(fileName));
}

/**
 * Whether an export is declared by the main or the email entry, with `@deprecated`, for a name of the internal one. A
 * tag where a name is declared in its own file, such as on an overload of `renderPage`, deprecates one way to call it.
 * @param symbol - The export.
 * @returns True for a name one of the two entries declares deprecated.
 */
function isDeprecatedForward(symbol: ts.Symbol): boolean {
    return (symbol.declarations ?? [])
        .filter(declaration => [ENTRY_POINTS.main, ENTRY_POINTS.email].includes(declaration.getSourceFile().fileName))
        .some(declaration => ts.getJSDocDeprecatedTag(declaration) !== undefined);
}

describe('the runtime entry point', () => {
    it('is built', () => {
        // the rest of this file reads `dist`, so a stale or absent build would make it pass by
        // describing nothing.
        expect(existsSync(join(distPath, 'index.js'))).toBe(true);
    });

    it.each(['index.js', 'internal.js'])('loads %s without typescript installed', entry => {
        // an application imports these entries to render a page, the second through zibri, and a compiler is a
        // build-time tool. Reaching one from here would put TypeScript in every deployed bundle - and the reason
        // the parser may use TypeScript at all is that nothing shipped to a running application does.
        expect(loadWithoutTypescript(entry)).toMatchObject({ loaded: true });
    });

    it('does not expose the compiler', () => {
        // eslint-disable-next-line typescript/no-require-imports, typescript/no-var-requires
        const runtime: Record<string, unknown> = require('../dist/index.js') as Record<string, unknown>;

        expect(runtime['parse']).toBeUndefined();
        expect(runtime['compile']).toBeUndefined();
        expect(runtime['createServerRuntime']).toBeDefined();
        expect(runtime['renderPage']).toBeDefined();
    });

    it.each(Object.keys(packageJson.exports).filter(subpath => subpath !== '.' && !subpath.endsWith('.json')))(
        'declares the types of %s to a consumer that resolves without "exports"',
        subpath => {
            // a file of a project beside this package, which reaches it through node_modules like any other
            const consumer: string = join(__dirname, '..', '..', '..', 'consumer.ts');
            const resolved: ts.ResolvedModuleFull | undefined = ts.resolveModuleName(
                `zibri-tsx/${subpath.slice(2)}`,
                consumer,
                { moduleResolution: ts.ModuleResolutionKind.Node10 },
                ts.sys
            ).resolvedModule;

            // what `"module": "commonjs"` resolves by, zibri's own build among them: it reads `types`
            // and `typesVersions` and never `exports`, so a subpath it cannot find is a package whose
            // types are `any` to it, as they were to zibri/webpack, the first to import one
            expect(resolved?.resolvedFileName).toMatch(/\.d\.ts$/);
        }
    );

    it('names neither the compiler nor TypeScript, so a deployment carries neither', () => {
        const manifest: { dependencies?: Record<string, string>, peerDependencies?: Record<string, string> } = packageJson;
        const named: string[] = [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})];

        // a package manager keeps a package a production one names in a deployment pruned of its
        // devDependencies, even an optional peer: declared here, TypeScript was 23 MB of every deployment
        expect(named.filter(name => name === 'typescript' || name === 'zibri-tsx-compiler')).toStrictEqual([]);
    });

    // TODO 4.0: remove with forward/
    it('forwards its subpath of the compiler to zibri-tsx-compiler', () => {
        // eslint-disable-next-line typescript/no-require-imports, typescript/no-var-requires
        const compiler: Record<string, unknown> = require('../forward/compiler.js') as Record<string, unknown>;

        expect(compiler['parseTemplate']).toBeDefined();
        expect(compiler['compile']).toBeDefined();
    });

    // TODO 4.0: remove with forward/
    it('warns once that a subpath of the compiler is removed in 4.0, naming what to name instead', () => {
        // a child of its own, as the warning is given once per process and printed to stderr
        const script: string = `
            require(${JSON.stringify(join(__dirname, '..', 'forward', 'webpack.js'))});
            require(${JSON.stringify(join(__dirname, '..', 'forward', 'webpack.js'))});
        `;
        const child: SpawnSyncReturns<string> = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 30000 });
        const warnings: string[] = child.stderr.split('\n').filter(line => line.includes('DeprecationWarning'));

        expect(warnings).toEqual([
            expect.stringContaining(
                '[ZIBRI_TSX_COMPILER_SUBPATH] DeprecationWarning: zibri-tsx/webpack is removed in 4.0. Name zibri-tsx-compiler/webpack instead'
            )
        ]);
    });
});

describe('the entry points zibri-tsx and zibri-tsx/internal', () => {
    const program: ts.Program = ts.createProgram([ENTRY_POINTS.main, ENTRY_POINTS.internal], resolveCompilerOptions());
    const checker: ts.TypeChecker = program.getTypeChecker();

    it('pass on every name the files behind them export, each on exactly one of them', () => {
        const main: ts.Symbol[] = resolveExports(program, checker, ENTRY_POINTS.main);
        // TODO 4.0: every name on main is public, once the names 3.0 exported there are no longer forwarded
        const forwarded: Set<string> = new Set(main.filter(isDeprecatedForward).map(symbol => symbol.name));
        const publicNames: Set<string> = new Set(main.filter(symbol => !isDeprecatedForward(symbol)).map(symbol => symbol.name));
        const internal: Set<string> = new Set(resolveExports(program, checker, ENTRY_POINTS.internal).map(symbol => symbol.name));
        const declared: string[] = [
            ...new Set(resolveReexportedFiles(program, checker)
                .flatMap(file => resolveExports(program, checker, file))
                .map(symbol => symbol.name))
        ];

        // not vacuous: the files behind the two entry points declare a few hundred names
        expect(declared.length).toBeGreaterThan(200);
        expect({
            onBoth: [...publicNames].filter(name => internal.has(name)),
            onNeither: declared.filter(name => !publicNames.has(name) && !internal.has(name)),
            forwardedButNotInternal: [...forwarded].filter(name => !internal.has(name))
        }).toEqual({ onBoth: [], onNeither: [], forwardedButNotInternal: [] });
    });

    // TODO 4.0: remove with the forwarded names
    it('keeps what 3.0 exported from zibri-tsx and zibri-tsx/internal now holds there, deprecated', () => {
        const forwarded: string[] = resolveExports(program, checker, ENTRY_POINTS.main)
            .filter(isDeprecatedForward)
            .map(symbol => symbol.name);

        // a minor release keeps every export of the one before, so each of these stays until 4.0
        expect(forwarded.toSorted()).toEqual([...MOVED_TO_INTERNAL_AFTER_3_0].toSorted());
    });
});