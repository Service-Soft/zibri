import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { NewCommand } from './new.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

// three installs rather than two: the harness goes in after the framework it peer depends on, so
// that npm resolves the peer to the copy this generator just installed rather than fetching one
const TEST_TIMEOUT_MS: number = 180_000;

describe('NewCommand (real npm install)', () => {
    let workDir: Path;

    beforeEach(async () => {
        workDir = await emptyWorkDirectory('new-command-heavy');
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
        await quietly(async () => new NewCommand().start(['n', 'api']));

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