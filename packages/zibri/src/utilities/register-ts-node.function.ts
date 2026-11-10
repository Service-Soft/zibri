import { resolveApplicationPackage } from './optional-peer.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * What installs the compiler of TypeScript files loaded at runtime: as dependencies, since a deployment that runs
 * worker files written in TypeScript loads them with it too.
 */
const TS_NODE_INSTALL: string = 'npm i ts-node typescript';

/**
 * Whether the compiler has already been hooked into `require`, which only ever needs doing once.
 */
let registered: boolean = false;

/**
 * Hooks a TypeScript compiler into `require`, so a `.ts` file can be loaded without being built.
 *
 * Lazily, and never on its own account. A production image runs compiled JavaScript, and a
 * framework that pulls a compiler into it is carrying a build tool's dependency tree through
 * container hardening review for a capability that image will never use. Registering at the moment
 * a TypeScript file is actually named means the cost - startup latency, the tree, the supply chain
 * surface - is paid by the deployments that asked for it.
 *
 * `ts-node` is loaded from the application rather than imported: an import is resolved when this module loads, and
 * the framework declares no dependency on it, so that a deployment pruned of its devDependencies carries none.
 * @param reason - What is being loaded, so a consumer without `ts-node` is told why it was needed.
 * @throws If `ts-node` is not installed.
 */
export function registerTsNode(reason: string): void {
    if (registered) {
        return;
    }
    let tsNode: typeof import('ts-node');
    try {
        tsNode = resolveApplicationPackage<typeof import('ts-node')>('ts-node', reason, TS_NODE_INSTALL);
    }
    catch (error) {
        throw new InternalError(
            `${reason} is TypeScript, which needs the package "ts-node" to be installed.`
            + ' Install it, or point this at the compiled JavaScript instead.',
            { cause: error }
        );
    }
    tsNode.register({ transpileOnly: true });
    registered = true;
}

/**
 * Checks that a TypeScript file could be compiled as it is loaded: that `ts-node` is installed, and
 * `typescript`, which it compiles with.
 *
 * Both are loaded, so a startup that asks is a startup that has paid for the compiler, which is
 * what the application said it wants by asking.
 * @param neededFor - What wants the compiler, so a missing package is named with why it was asked for.
 * @throws If `ts-node` or `typescript` is not installed.
 */
export function validateTsNodeInstalled(neededFor: string): void {
    resolveApplicationPackage('ts-node', neededFor, TS_NODE_INSTALL);
    // asked for on its own: ts-node resolves it only once it compiles something, and an image that
    // pruned its devDependencies has ts-node without it
    resolveApplicationPackage('typescript', neededFor, TS_NODE_INSTALL);
}

/**
 * The extensions a TypeScript compiler has to be hooked in for.
 *
 * `.mts` is absent on purpose: it is an es module, so it is loaded through `import` rather than
 * `require`, and the hook this registers only covers the latter.
 */
const typeScriptExtensions: string[] = ['.ts', '.tsx', '.cts'];

/**
 * Whether loading this file needs a TypeScript compiler.
 * @param filePath - The file about to be loaded.
 * @returns True for a file `require` cannot read on its own.
 */
export function needsTsNode(filePath: string): boolean {
    return typeScriptExtensions.some(extension => filePath.toLowerCase().endsWith(extension));
}