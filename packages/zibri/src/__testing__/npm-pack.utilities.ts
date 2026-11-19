import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { JsonUtilities } from '../utilities/json.utilities';

/**
 * What `npm publish` would upload, without publishing anything.
 */
export type PackedTarball = {
    /**
     * Every path the tarball would contain, relative to the package root.
     */
    files: string[],
    /**
     * What those files weigh once installed, in bytes.
     */
    unpackedSize: number
};

/**
 * Reads what a package of the repository would publish.
 */
export abstract class NpmPackUtilities {

    /**
     * Runs `npm pack` without publishing.
     * @param packageDir - The folder of the package.
     * @returns The tarball's contents and installed size.
     */
    static resolveTarball(packageDir: string): PackedTarball {
        const output: string = execFileSync(
            'npm',
            // a cache of its own: `npm pack` writes to one, and reading the tarball a manifest describes
            // has nothing to do with whatever the machine's shared cache happens to hold or allow
            ['pack', '--dry-run', '--json', '--cache', path.join(tmpdir(), 'zibri-npm-pack-cache')],
            {
                cwd: packageDir,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
                // a line per file of the tarball: zibri's sources alone are more than the 1 MiB it reads by default
                maxBuffer: 64 * 1024 * 1024
            }
        );
        const parsed: { files: { path: string }[], unpackedSize: number }[] = JsonUtilities.parse(output);
        // `npm pack --json` reports one entry per tarball, and one tarball was asked for
        const [tarball] = parsed;
        assert(tarball, 'npm pack reported no tarball');
        return { files: tarball.files.map(f => f.path), unpackedSize: tarball.unpackedSize };
    }
}
