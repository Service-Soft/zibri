
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Resolves the root of the zibri package, no matter the runtime.
 * @param resolvePackageJsonPath - Defaults to the real require.resolve, overridable in tests since
 * self-referencing makes the default always succeed when called from inside this package.
 * @returns The path of the compiled zibri package.
 * @throws When the package could not be found.
 */
export function resolveZibriRoot(resolvePackageJsonPath: () => string = () => require.resolve('zibri/package.json')): FsPath {
    try {
        // Bundlers (eg. webpack) that can statically resolve this call rewrite it to a module id (a number),
        // not a path string, which makes getPath/dirName throw below and fall through to the manual walk.
        // Keep the fallback even though require.resolve succeeds in plain (unbundled) Node.js.
        return FsUtilities.dirName(FsUtilities.getPath(resolvePackageJsonPath()));
    }
    catch {
        // continue
    }

    let dir: string = process.cwd();

    while (true) {
        const nodeModulesCandidate: FsPath = FsUtilities.getPath(dir, 'node_modules', 'zibri', 'package.json');
        const directCandidate: FsPath = FsUtilities.getPath(dir, 'package.json');

        if (FsUtilities.existsSync(nodeModulesCandidate)) {
            return FsUtilities.dirName(nodeModulesCandidate);
        }
        if (FsUtilities.existsSync(directCandidate)) {
            const content: string = FsUtilities.readFileSync(directCandidate);
            // eslint-disable-next-line jsdoc/require-jsdoc
            const { name } = JsonUtilities.parse<{ name: string }>(content);
            if (name === 'zibri') {
                return FsUtilities.dirName(directCandidate);
            }

        }

        const parent: string = FsUtilities.dirName(FsUtilities.getPath(dir));
        if (parent === dir) {
            throw new Error('Zibri runtime root could not be resolved');
        }
        dir = parent;
    }
}