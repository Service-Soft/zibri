import { ForkOptions } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

import { FsPath, FsUtilities, optionalPeer } from 'zibri';

import { CLUSTER_MODULE_PATHS_ENV } from './cluster/cluster-message.model';
import { clusterModulePaths } from './cluster/cluster-module-paths';

/**
 * Whether this runs from the sources rather than from the built package.
 */
const fromSources: boolean = __filename.endsWith('.ts');

/**
 * The module that points the shared packages at the parent's files, preloaded into each forked process.
 *
 * Named by this file's own extension, which is what makes the harness work from both sides of the
 * build: `.ts` beside these sources, `.js` in the `dist` a consumer installs.
 */
const modulePathsPreload: FsPath = FsUtilities.getPath(
    __dirname,
    'cluster',
    `cluster-module-paths${fromSources ? '.ts' : '.js'}`
);

/**
 * Where the forked processes keep what each file transpiled to, the way build tools keep their caches.
 * Named by a hash of the input, so deleting it is only ever slower, never wrong.
 */
const typeScriptCacheFolder: FsPath = FsUtilities.getPath(process.cwd(), 'node_modules', '.cache', 'zibri-testing', 'typescript');

/**
 * The module a forked process loads TypeScript with: ts-node, with what each file transpiles to kept
 * in {@link typeScriptCacheFolder}.
 *
 * Loaded with a plain require, before anything can be compiled. In `dist` it is JavaScript already;
 * from the sources it is transpiled here, once for each version of it.
 * @returns The path of the module.
 */
function resolveCachedTsNode(): FsPath {
    if (!fromSources) {
        return FsUtilities.getPath(__dirname, 'cached-ts-node.js');
    }
    const source: string = readFileSync(FsUtilities.getPath(__dirname, 'cached-ts-node.ts'), 'utf8');
    const compiled: FsPath = FsUtilities.getPath(
        typeScriptCacheFolder,
        // eslint-disable-next-line stylistic/newline-per-chained-call
        `cached-ts-node-${createHash('sha256').update(source).digest('hex')}.js`
    );
    if (!existsSync(compiled)) {
        const ts: typeof import('typescript') = optionalPeer<typeof import('typescript')>(
            'typescript',
            'Transpiling the TypeScript hook of forked processes'
        );
        const output: string = ts.transpileModule(source, {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        }).outputText;
        mkdirSync(typeScriptCacheFolder, { recursive: true });
        // under a name of its own first, so that a process forked meanwhile never loads half of it
        const partial: string = `${compiled}.${process.pid}.partial`;
        writeFileSync(partial, output);
        renameSync(partial, compiled);
    }
    return compiled;
}

/**
 * What a child process is forked with to run TypeScript the way the parent does: through ts-node,
 * loading the same copy of `zibri`, `zibri/internal` and `zibri-testing` as the parent.
 *
 * What each file transpiles to is kept in `node_modules/.cache/zibri-testing`, so a process after the
 * first loads the framework without compiling it again. A worker thread the child starts runs
 * TypeScript the same way.
 * @param feature - What forks the process, as the error for a missing ts-node names it.
 * @returns The `execArgv` and `env` to fork with. The `env` holds the parent's environment.
 * @throws When ts-node is not installed, before anything is forked: a child that cannot find it dies
 * before it can say why.
 */
export function resolveTypeScriptForkOptions(feature: string): Required<Pick<ForkOptions, 'execArgv' | 'env'>> {
    // jest's transform only exists inside the jest process, so the child needs a typescript hook of its
    // own. ts-node rather than swc: it is already an optional peer of the framework, and it is the same
    // compiler the framework is built with, so emitDecoratorMetadata behaves identically instead of
    // merely similarly
    optionalPeer('ts-node', feature);
    return {
        // the module paths preloaded rather than imported by the entry, because a worker thread starts
        // with the execArgv of the thread that created it and never runs the entry
        execArgv: ['-r', resolveCachedTsNode(), '-r', modulePathsPreload],
        env: {
            ...process.env,
            TS_NODE_TRANSPILE_ONLY: 'true',
            TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
            ZIBRI_TESTING_TYPESCRIPT_CACHE: typeScriptCacheFolder,
            // which copy of the framework to use. A bare `zibri` in the child resolves through
            // node_modules to the built package, while the module it runs reaches the framework
            // however its own imports say - inside this repository, the source tree beside it. That
            // is two copies in one process, and the framework refuses the second one.
            [CLUSTER_MODULE_PATHS_ENV]: JSON.stringify(clusterModulePaths())
        }
    };
}