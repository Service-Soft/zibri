import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { defineProvider, DiProvider, FsPath, UUIDUtilities, ZIBRI_DI_TOKENS } from 'zibri';

/**
 * A translation source with nothing in it: what the build writes for an application that marks no
 * string for translation.
 */
const EMPTY_SOURCE_XLF: string = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<xliff xmlns="urn:oasis:names:tc:xliff:document:1.2" version="1.2"/>\n';

/**
 * Where the scratch directories of a run are collected.
 *
 * Inside the project's test folder rather than under the operating system's temp directory, because
 * the first thing anyone does with a failing test is look at what it wrote. This is the layout the
 * framework's own suite uses, so a consumer's test output sits where they already look for it.
 *
 * Resolved from the working directory because that is where a test runner runs: `src/__testing__` of
 * whichever project invoked it, which for the framework's own suite is the folder it already writes
 * to.
 */
const scratchRoot: FsPath = path.join(process.cwd(), 'src', '__testing__', 'file-output') as FsPath;

/**
 * Creates the directory one test server writes into, one per started server: two servers in the
 * same file do not read back each other's route history.
 * @returns The directory, which the caller owns and is responsible for removing.
 */
export function createScratchDirectory(): FsPath {
    const scratchPath: FsPath = path.join(scratchRoot, `server-${UUIDUtilities.generate()}`) as FsPath;
    mkdirSync(scratchPath, { recursive: true });
    // the directory stands in for a project, and a project has this folder: it is checked in rather
    // than produced by a run, so the application refuses to start when it is missing instead of
    // treating the version it is on as the first that ever existed
    mkdirSync(path.join(scratchPath, 'versions'), { recursive: true });
    // the translations a build would have written, with nothing in them: the localize service then
    // starts the way it does in a deployment, reading the file, rather than warning on every boot
    // that an application under test translates nothing
    mkdirSync(path.join(scratchPath, 'translations'), { recursive: true });
    writeFileSync(path.join(scratchPath, 'translations', 'source.xlf'), EMPTY_SOURCE_XLF);
    return scratchPath;
}

/**
 * Removes a scratch directory and everything a test server wrote into it.
 *
 * Called when the server shuts down, and when its boot fails. A suite that never shuts its server
 * down leaves the directory where it is.
 * @param scratchPath - The directory to remove.
 */
export function removeScratchDirectory(scratchPath: FsPath): void {
    rmSync(scratchPath, { recursive: true, force: true });
}

/**
 * Points everything the framework writes at runtime into the given directory.
 *
 * Listed before whatever the call and the application provide, so a suite that names one of these
 * itself - to seed a history, or to read one back after the server is gone - still wins.
 * @param scratchPath - The directory to write into.
 * @returns One provider per path the framework writes to.
 */
export function scratchProviders(scratchPath: FsPath): DiProvider<unknown>[] {
    return [
        defineProvider({
            token: ZIBRI_DI_TOKENS.VERSIONS_PATH,
            useValue: path.join(scratchPath, 'versions') as FsPath
        }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH,
            useValue: path.join(scratchPath, 'translations') as FsPath
        }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.FILE_UPLOAD_TEMP_FOLDER,
            useValue: path.join(scratchPath, 'uploads') as FsPath
        }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER,
            useValue: path.join(scratchPath, 'backups') as FsPath
        })
    ];
}