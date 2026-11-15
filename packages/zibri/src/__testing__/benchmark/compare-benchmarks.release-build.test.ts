import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { afterAll, describe, expect, it } from '@jest/globals';

import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { testFileFolder } from '../constants';

/**
 * How `scripts/compare-benchmarks.mjs` builds the release it compares with: as the benchmark job builds
 * the checkout, with the packages the release has.
 */

const scriptPath: string = path.resolve(__dirname, '..', '..', '..', 'scripts', 'compare-benchmarks.mjs');
const repoRoot: string = path.resolve(__dirname, '..', '..', '..', '..', '..');
const folder: FsPath = FsUtilities.getPath(testFileFolder, `compare-benchmarks-release-build-${UUIDUtilities.generate()}`);

/**
 * Resolves the workspaces the script builds a checkout from, in the script's own process, since jest
 * cannot load a module.
 * @param root - The root of the checkout.
 * @returns The workspaces, in the order they are built.
 */
function resolveWorkspacesToBuild(root: string): string[] {
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const { resolveWorkspacesToBuild } = await import('${pathToFileURL(scriptPath).href}');
        console.log(JSON.stringify(resolveWorkspacesToBuild(${JsonUtilities.stringify(root)})));
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
}

afterAll(async () => {
    await FsUtilities.rm(folder);
});

describe('building the release the benchmarks are compared with', () => {
    // zibri imports zibri-contract, which the job builds first: a release without it built failed to compile
    it('builds the workspaces the benchmark job builds the checkout from, in its order', () => {
        const ci: string = readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8');
        const job: string = ci.slice(ci.indexOf('\n    benchmark:\n'), ci.indexOf('npm run test:benchmark:compare'));
        const built: string[] = [...job.matchAll(/npm run build\S* -w (\S+)/g)].map(match => match[1] ?? '');

        expect(built).toContain('zibri-contract');
        expect(resolveWorkspacesToBuild(repoRoot)).toStrictEqual(built);
    });

    it('builds only the packages a release has, so that one from before a package was split off builds', async () => {
        for (const dir of ['tsx', 'zibri']) {
            await FsUtilities.mkdir(FsUtilities.getPath(folder, 'packages', dir));
        }

        expect(resolveWorkspacesToBuild(folder)).toStrictEqual(['zibri-tsx', 'zibri']);
    });
});