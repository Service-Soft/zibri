// Preloaded (`--import`) into every thread of a cluster instance, before anything else it loads: a
// worker thread starts with the flags of the thread that created it and never runs the entry, so
// whatever the entry did itself would reach the instance's main thread only, and every thread job
// would load the built packages instead of the copy the instance runs.
//
// When the harness runs from its sources this file is TypeScript that nothing can compile yet, so
// node's own type stripping loads it: node builtins, type only imports written as such, and no syntax
// only TypeScript has.
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';

import type { TypeScriptLoaderUtilities } from 'zibri';

import { CLUSTER_INSTANCE_OPTIONS_ENV, CLUSTER_MODULE_PATHS_ENV, CLUSTER_TYPESCRIPT_LOADER_ENV } from './cluster-message.model.ts';

/**
 * The module that declares the framework's TypeScript loader.
 */
type TypeScriptLoaderModule = {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    TypeScriptLoaderUtilities: typeof TypeScriptLoaderUtilities
};

/**
 * Points the shared packages at the files the parent named, for the rest of this thread.
 *
 * Only the bare package names. A subpath is left alone, so nothing here decides where
 * `zibri/package.json` comes from.
 */
function applyClusterModulePaths(): void {
    const raw: string | undefined = process.env[CLUSTER_MODULE_PATHS_ENV];
    if (raw == undefined) {
        return;
    }
    const paths: Record<string, string> = JSON.parse(raw) as Record<string, string>;
    registerHooks({
        resolve: (specifier, context, nextResolve) => {
            const file: string | undefined = paths[specifier];
            // resolved rather than answered directly, so node still says what format the file has
            return nextResolve(file == undefined ? specifier : pathToFileURL(file).href, context);
        }
    });
}

/**
 * Registers the framework's TypeScript loader in this thread, when the instance boots from a
 * TypeScript file - its own entry, run from the sources, or the options module.
 */
function registerTypeScriptLoader(): void {
    const loaderFile: string | undefined = process.env[CLUSTER_TYPESCRIPT_LOADER_ENV];
    if (loaderFile == undefined) {
        return;
    }
    // required rather than imported, so this preload does not await at its top level
    const loader: TypeScriptLoaderModule = createRequire(import.meta.url)(loaderFile) as TypeScriptLoaderModule;
    const typeScriptFile: string | undefined = [process.argv[1], process.env[CLUSTER_INSTANCE_OPTIONS_ENV]]
        .find(file => file != undefined && loader.TypeScriptLoaderUtilities.isNeededFor(file));
    if (typeScriptFile != undefined) {
        loader.TypeScriptLoaderUtilities.register(`The cluster instance file ${typeScriptFile}`);
    }
}

registerTypeScriptLoader();
applyClusterModulePaths();
