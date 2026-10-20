import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The entry point of this copy of the framework, as an absolute file path.
 *
 * What a process hands on when another one has to load the very same copy, such as a test cluster
 * starting its instances.
 */
// worked out from this file rather than resolved by name: a test runner that maps `zibri` to the
// sources answers resolution with the built package, which is a second copy. The entry shares this
// file's extension - `.ts` in the sources, `.js` once built
export const ZIBRI_ENTRY_FILE: string = fileURLToPath(new URL(`./index${path.extname(import.meta.filename)}`, import.meta.url));
