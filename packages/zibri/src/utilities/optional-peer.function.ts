import { AsyncLocalStorage } from 'node:async_hooks';
import { createRequire } from 'node:module';

import { FsUtilities } from './fs.utilities';
import { resolveAppRoot } from './resolve-app-root.function';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * The peers already loaded, so asking again costs nothing.
 */
const loadedPeers: Map<string, unknown> = new Map();

/**
 * Runs a function in the async context the framework was loaded in, which holds no store of any
 * call.
 */
// a peer is loaded by the first call that needs it, and what the peer starts as it loads - a
// channel, a timer, a pool - keeps the async context it was started in for as long as it lives, and
// runs its callbacks in it. Loaded in the caller's, that was the first request's tenant and user for
// the life of the process; under jest, @prometheus-io/client's channel kept every test file's
// environment alive that way, and a worker grew by a few dozen megabytes per file
const runOutsideAnyCall: <R>(fn: () => R) => R = AsyncLocalStorage.snapshot();

/**
 * Resolution done by node, from where the application keeps its packages.
 *
 * A bundler rewrites `require` and `require.resolve` into lookups in its own module map, and a
 * package it was told to leave external is not in that map. Asking through them therefore answers
 * that an installed peer is missing, and every feature guarded by one refuses to start in exactly
 * the shape a deployment ships: bundled. `createRequire` hands back node's own resolution, which
 * gives the same answer bundled or not.
 *
 * Anchored to the application's root rather than to this file, because that is where the peer is
 * installed - inside a bundle this file no longer exists to resolve from.
 */
let requireFromApplication: ReturnType<typeof createRequire> | undefined;

/**
 * Resolves and loads packages the way the running application would.
 * @returns A require anchored at the application's root.
 */
function applicationRequire(): ReturnType<typeof createRequire> {
    // a file that does not have to exist: `createRequire` takes it as the place to resolve *from*,
    // and a directory would have to be spelled with a trailing separator to mean the same thing
    requireFromApplication ??= createRequire(FsUtilities.getPath(resolveAppRoot(), 'resolve-peers-from-here.js'));
    return requireFromApplication;
}

// `peerDependenciesMeta` calling something optional is a promise that installing a package does not
// install it, and a top level `import` breaks that promise for everyone: the import is resolved when
// its module loads, and the module loads because the barrel re-exports it, so a package nobody uses
// is one every consumer has to have. Reaching for it here instead means the cost is paid by the
// feature that needs it.
/**
 * Loads a peer dependency a consumer is allowed not to have.
 *
 * Call it where a feature is *set up*, wherever there is such a place - a data source is constructed
 * at boot, so a missing driver is a boot failure, not a surprise on the first query.
 * @param name - The package to load.
 * @param neededFor - The feature that wants it, so the error says why it was asked for.
 * @returns The package's exports.
 * @throws If the package is not installed, or cannot be loaded.
 */
export function optionalPeer<T>(name: string, neededFor: string): T {
    const cached: unknown = loadedPeers.get(name);
    if (cached != undefined) {
        return cached as T;
    }

    let loaded: T;
    try {
        // eslint-disable-next-line typescript/no-unsafe-return
        loaded = runOutsideAnyCall(() => applicationRequire()(name)) as T;
    }
    catch (error) {
        // a peer that resolves is installed, and telling its user to install it again hides the
        // reason it failed, such as an es module only package in a runtime that cannot load one
        if (hasOptionalPeer(name)) {
            throw new InternalError(
                [
                    `${neededFor} needs the optional peer dependency "${name}", which is installed but could not be loaded:`,
                    error instanceof Error ? error.message : String(error)
                ],
                { cause: error }
            );
        }
        throw new InternalError(
            [
                `${neededFor} needs the optional peer dependency "${name}", which is not installed.`,
                `Run "npm i ${name}" to use it.`
            ],
            { cause: error }
        );
    }
    loadedPeers.set(name, loaded);
    return loaded;
}

/**
 * Whether a peer dependency could be loaded, without loading it.
 *
 * Resolution only, so a startup check can ask whether a feature is usable without paying for the
 * package in a process that will never use it.
 * @param name - The package to look for.
 * @returns True if it is installed.
 */
export function hasOptionalPeer(name: string): boolean {
    try {
        applicationRequire().resolve(name);
        return true;
    }
    catch {
        return false;
    }
}