import { FsPath, FsUtilities } from './fs.utilities';

/**
 * Resolves the root of the application that is running, meaning the nearest package.json above its
 * entry point.
 *
 * Deliberately not `process.cwd()`. That is wherever the command happened to be run from, so
 * `npm run start -w api` in a monorepo would resolve the repository root rather than the api package,
 * and the same application would write to different places depending on which directory someone
 * started it from. The entry module sits inside the application itself, whatever the caller's shell
 * was doing.
 *
 * Directories inside node_modules are skipped, so an application started through an installed bin
 * resolves to itself rather than to the package providing that bin.
 * @param entryPath - The entry file to walk up from. Overridable for tests.
 * @returns The application root, falling back to the working directory when nothing can be found.
 */
export function resolveAppRoot(entryPath: string | undefined = require.main?.filename ?? process.argv[1]): FsPath {
    if (entryPath == undefined) {
        return FsUtilities.getPath(process.cwd());
    }

    let dir: FsPath = FsUtilities.dirName(FsUtilities.getPath(entryPath));

    while (true) {
        if (!dir.includes('node_modules') && FsUtilities.existsSync(FsUtilities.getPath(dir, 'package.json'))) {
            return dir;
        }

        const parent: FsPath = FsUtilities.dirName(dir);
        if (parent === dir) {
            return FsUtilities.getPath(process.cwd());
        }
        dir = parent;
    }
}