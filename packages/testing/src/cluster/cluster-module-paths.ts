import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ZIBRI_ENTRY_FILE } from 'zibri';

/**
 * Where this process loaded `zibri` and `zibri-testing` from: the packages an instance and its
 * parent have to load from the same file.
 *
 * Both of them, rather than the framework alone: `zibri-testing` declares `ClusterMark`, and an
 * entity is identified by its class, so two copies of this package would leave the instance writing
 * rows the parent cannot read back.
 *
 * Each package names its own entry point rather than having the names resolved, which is what makes
 * this right in both worlds: a test runner that maps the package names to a source tree answers
 * resolution with the built packages, while the loaded modules know where they are.
 * @returns One absolute path per package, by package name.
 */
export function clusterModulePaths(): Record<string, string> {
    return {
        zibri: ZIBRI_ENTRY_FILE,
        // the entry shares this file's extension: `.ts` in the sources, `.js` once built
        'zibri-testing': fileURLToPath(new URL(`../index${path.extname(import.meta.filename)}`, import.meta.url))
    };
}
