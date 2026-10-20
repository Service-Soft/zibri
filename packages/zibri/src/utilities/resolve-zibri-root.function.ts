import { createRequire } from 'node:module';

import { FsPath, FsUtilities } from './fs.utilities.ts';
import { JsonUtilities } from './json.utilities.ts';

/**
 * Resolves the root of the zibri package, no matter the runtime.
 * @param resolvePackageJsonPath - Defaults to the real require.resolve, overridable in tests since
 * self-referencing makes the default always succeed when called from inside this package.
 * @returns The path of the compiled zibri package.
 * @throws When the package could not be found.
 */
export function resolveZibriRoot(
    resolvePackageJsonPath: () => string = () => createRequire(import.meta.url).resolve('zibri/package.json')
): FsPath {
    try {
        // a bundle the framework is compiled into resolves from wherever the bundle is, which need not
        // have zibri installed beside it. Keep the fallback even though the resolution succeeds in plain
        // (unbundled) Node.js.
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
            // eslint-disable-next-line jsdoc-js/require-jsdoc
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