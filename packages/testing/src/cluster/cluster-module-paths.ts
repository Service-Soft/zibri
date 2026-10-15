import Module from 'node:module';

import { CLUSTER_MODULE_PATHS_ENV } from './cluster-message.model';

/**
 * The packages an instance and its parent have to load from the same file.
 *
 * Both of them, rather than the framework alone: `zibri-testing` declares `ClusterMark`, and an
 * entity is identified by its class, so two copies of this package would leave the instance writing
 * rows the parent cannot read back.
 */
const SHARED_PACKAGES: string[] = ['zibri', 'zibri-testing'];

/**
 * Where this process loaded the shared packages from.
 *
 * Resolved through this module's own `require`, which is what makes it right in both worlds: under
 * a test runner that maps the package names to a source tree it answers with those files, and in an
 * installed package it answers with whatever `node_modules` holds.
 * @returns One absolute path per package that resolves here, by package name.
 */
export function clusterModulePaths(): Record<string, string> {
    const res: Record<string, string> = {};
    for (const name of SHARED_PACKAGES) {
        try {
            res[name] = require.resolve(name);
        }
        catch {
            // a harness that does not resolve one of these by name has nothing to hand on about it,
            // and the instance falls back to resolving it for itself
        }
    }
    return res;
}

/**
 * How node turns a request like `zibri` into a file path.
 *
 * Not part of node's public surface, and there is no public equivalent for commonjs: `Module.register`
 * hooks esm only, and every resolution here happens through `require`.
 */
type ResolveFilename = (this: unknown, request: string, ...rest: unknown[]) => string;

/**
 * Points the shared packages at the files the parent named, for the rest of this thread.
 *
 * Runs as a preload (`-r`) of every instance, so it comes before anything else in each of its
 * threads: a mapping installed after the framework has already been loaded from somewhere else
 * changes nothing.
 */
function applyClusterModulePaths(): void {
    const raw: string | undefined = process.env[CLUSTER_MODULE_PATHS_ENV];
    if (raw == undefined) {
        return;
    }
    const paths: Record<string, string> = JSON.parse(raw) as Record<string, string>;
    // eslint-disable-next-line jsdoc/require-jsdoc
    const resolving: { _resolveFilename: ResolveFilename } = Module as unknown as {
        // eslint-disable-next-line jsdoc/require-jsdoc
        _resolveFilename: ResolveFilename
    };
    const original: ResolveFilename = resolving._resolveFilename;

    resolving._resolveFilename = function(request: string, ...rest: unknown[]): string {
        // only the bare package name. A subpath is left alone, so nothing here decides where
        // `zibri/package.json` comes from.
        return paths[request] ?? original.call(this, request, ...rest);
    };
}

applyClusterModulePaths();