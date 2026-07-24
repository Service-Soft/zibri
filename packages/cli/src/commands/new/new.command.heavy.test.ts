import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { NewCommand } from './new.command';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

const TEST_TIMEOUT_MS: number = 120_000;

describe('NewCommand (real npm install)', () => {
    let workDir: Path;

    beforeEach(async () => {
        workDir = path.join(os.tmpdir(), `zibri-cli-new-command-heavy-test-${Date.now()}`) as Path;
        await FsUtilities.mkdir(workDir);
        CPUtilities['cwd'] = workDir;
        // Only set for this test: makes the generated app depend on the local zibri workspace build
        // instead of the published npm package, matching how "npm run clear" is used during development.
        process.env['ZIBRI_CLI_LOCAL_DEV'] = '1';
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['ZIBRI_CLI_LOCAL_DEV'];
        await FsUtilities.rm(workDir);
    }, TEST_TIMEOUT_MS);

    it('really installs devDependencies and links zibri to the local workspace build', async () => {
        await new NewCommand().start(['n', 'api']);

        const appDir: Path = path.join(workDir, 'api') as Path;
        expect(await FsUtilities.exists(path.join(appDir, 'node_modules', 'webpack') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'node_modules', 'chart.js') as Path)).toBe(true);
        expect(await FsUtilities.exists(path.join(appDir, 'node_modules', 'zibri', 'dist') as Path)).toBe(true);

        // eslint-disable-next-line typescript/no-unsafe-assignment
        const packageJson: { dependencies: Record<string, string> } = JSON.parse(
            await FsUtilities.readFile(path.join(appDir, 'package.json') as Path)
        );
        expect(packageJson.dependencies['zibri']).toMatch(/^file:/);
    }, TEST_TIMEOUT_MS);
});