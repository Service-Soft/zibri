import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

import { TypeScriptLoaderUtilities } from '../../../utilities/typescript-loader/typescript-loader.utilities.ts';

/**
 * Node's own `require`, whose cache is the one every commonjs module is loaded into.
 */
const nodeRequire: NodeJS.Require = createRequire(import.meta.url);

/**
 * The files that turned out to be es modules, so the next run of one knows to ask for a new copy.
 *
 * Recorded on the way through rather than worked out in advance: whether a `.js` file is an es
 * module depends on the nearest `package.json`, so answering it up front would mean implementing
 * node's own resolution. Loading it once says so exactly.
 */
const esModuleFiles: Set<string> = new Set();

/**
 * How many copies have been asked for, so each one is a url the loader has not seen.
 */
let freshLoadCount: number = 0;

/**
 * Anything that might carry the tag an es module namespace carries.
 */
type Tagged = {
    /**
     * `'Module'` on an es module namespace, and absent on a commonjs exports object.
     */
    [Symbol.toStringTag]?: unknown
};

/**
 * Whether what was loaded is an es module rather than a commonjs one.
 * @param loaded - Whatever the load returned.
 * @returns True for an es module namespace.
 */
function isModuleNamespace(loaded: unknown): boolean {
    return typeof loaded === 'object' && loaded != undefined
        && (loaded as Tagged)[Symbol.toStringTag] === 'Module';
}

/**
 * Runs a worker file, from the top, every time it is asked for.
 *
 * A thread job *is* the top level code of the file it names - that is where `reportCompletion` is
 * called from - and one worker thread runs many jobs, so every run has to evaluate the file again.
 * How that is done depends on what the file is, and the two mechanisms have nothing in common.
 *
 * A commonjs or TypeScript file is dropped from `require.cache` first, which is what makes the next
 * `require` evaluate it rather than hand back what the last job left behind.
 *
 * An es module cannot be dropped from anything: the loader's registry is keyed by url and has no
 * way to remove an entry, and `require` of one that is already loaded returns the same namespace
 * without re-evaluating it. So the second run of such a file used to do nothing at all - the job
 * reported nothing and waited out its timeout, with the first job on that thread having worked
 * perfectly. Asking for it under a url the loader has not seen is the only way to get it run again.
 *
 * The copies do accumulate for a file loaded that way, one per run, since nothing can evict them.
 * That is the price of the file being an es module, and it is paid only by jobs that are.
 * @param filePath - The absolute path of the file to run.
 */
export async function loadWorkerFile(filePath: string): Promise<void> {
    if (TypeScriptLoaderUtilities.isNeededFor(filePath)) {
        TypeScriptLoaderUtilities.register(`The worker file ${filePath}`);
    }

    if (!esModuleFiles.has(filePath)) {
        const outcome: RequireOutcome = requireWorkerFile(filePath);
        if (outcome !== 'refused') {
            // it has just run. An es module only needs importing from the *next* job on, so
            // importing it here as well would run the file twice for this one
            if (outcome === 'ran an es module') {
                esModuleFiles.add(filePath);
            }
            return;
        }
        esModuleFiles.add(filePath);
    }

    freshLoadCount++;
    // a file of the application, which a bundler of this package has nothing to resolve
    await import(`${pathToFileURL(filePath).href}?zibriRun=${freshLoadCount}`);
}

/**
 * What happened when the file was handed to `require`.
 */
type RequireOutcome = 'ran a commonjs module' | 'ran an es module' | 'refused';

/**
 * Runs the file through `require`, if that is something `require` can do with it.
 * @param filePath - The file to run.
 * @returns What require made of it.
 * @throws Whatever the file itself threw, which is the job failing rather than the load.
 */
function requireWorkerFile(filePath: string): RequireOutcome {
    try {
        // eslint-disable-next-line typescript/no-dynamic-delete
        delete nodeRequire.cache[filePath];
        const loaded: unknown = nodeRequire(filePath);
        return isModuleNamespace(loaded) ? 'ran an es module' : 'ran a commonjs module';
    }
    catch (error) {
        // a module that awaits at the top level is the one thing `require` refuses outright, on
        // every version of node - it would have to block to finish loading it. Nothing is wrong with
        // such a file, and importing it is the answer rather than failing the job.
        if (typeof error === 'object' && error != undefined && 'code' in error && error.code === 'ERR_REQUIRE_ASYNC_MODULE') {
            return 'refused';
        }
        throw error;
    }
}