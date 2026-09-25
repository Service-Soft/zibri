import { InternalError } from '../error-handling/internal-error.model';

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
 * `ts-node` is reached through `require` rather than an import for the same reason: an import is
 * resolved when this module loads, which would make an optional peer dependency mandatory again by
 * the back door.
 * @param reason - What is being loaded, so a consumer without `ts-node` is told why it was needed.
 * @throws If `ts-node` is not installed.
 */
export function registerTsNode(reason: string): void {
    if (registered) {
        return;
    }
    let tsNode: typeof import('ts-node');
    try {
        // eslint-disable-next-line typescript/no-require-imports, typescript/no-var-requires
        tsNode = require('ts-node') as typeof import('ts-node');
    }
    catch (error) {
        throw new InternalError(
            `${reason} is TypeScript, which needs the optional peer dependency "ts-node" to be installed.`
            + ' Install it, or point this at the compiled JavaScript instead.',
            { cause: error }
        );
    }
    tsNode.register({ transpileOnly: true });
    registered = true;
}

/**
 * Whether a TypeScript compiler could be loaded, without loading one.
 *
 * Resolution only, so this answers the question a startup check asks - is the optional peer
 * dependency there - without paying for the compiler in the process that asked.
 * @returns True if `ts-node` is installed.
 */
export function isTsNodeInstalled(): boolean {
    try {
        require.resolve('ts-node');
        return true;
    }
    catch {
        return false;
    }
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