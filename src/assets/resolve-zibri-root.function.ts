
import { FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';

/**
 * Resolves the root of the zibri package, no matter the runtime.
 * @returns The path of the compiled zibri package.
 * @throws When the package could not be found.
 */
export function resolveZibriRoot(): FsPath {
    try {
        return FsUtilities.dirName(FsUtilities.getPath(require.resolve('zibri/package.json')));
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