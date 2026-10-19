import { execSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { NewCommand } from './new.command';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { findWorkflowCommands } from '../../__testing__/find-workflow-commands.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

// three installs rather than two: the harness goes in after the framework it peer depends on, so
// that npm resolves the peer to the copy this generator just installed rather than fetching one
const TEST_TIMEOUT_MS: number = 180_000;
// those installs, then the workflow's own clean install, a build and the tests
const CI_WORKFLOW_TIMEOUT_MS: number = 600_000;

describe('NewCommand (real npm install)', () => {
    let workDir: Path;

    beforeEach(async () => {
        workDir = await emptyWorkDirectory('new-command-heavy');
        CPUtilities['cwd'] = workDir;
        // Only set for this test: makes the generated app depend on the local zibri workspace build
        // instead of the published npm package, matching how "npm run clear" is used during development.
        process.env['ZIBRI_CLI_LOCAL_DEV'] = '1';
    });

    // the generated project is left where it is and cleared by emptyWorkDirectory at the start of the
    // next run. Removing it here raced the install whenever the test timed out - jest stops waiting
    // but the npm child keeps writing into the folder, so the removal failed with ENOTEMPTY on top of
    // the timeout - and it deleted the half installed project that says why the install was slow
    afterEach(() => {
        CPUtilities['cwd'] = undefined;
        delete process.env['ZIBRI_CLI_LOCAL_DEV'];
    });

    it('really installs devDependencies and links zibri to the local workspace build', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));

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

    it('builds only what the bundle imports, so a broken test does not break the build', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin']));
        const appDir: Path = path.join(workDir, 'api') as Path;
        // jest reports this when the tests run. The build used to compile every file the tsconfig
        // includes, so it failed here too and "start" never restarted the server
        await FsUtilities.createFile(path.join(appDir, 'src', 'broken.test.ts') as Path, 'export const broken: number = \'not a number\';');

        execSync('npm run build', { cwd: appDir, stdio: 'pipe' });
    }, CI_WORKFLOW_TIMEOUT_MS);

    it('passes its own ci workflow on a checkout, which has no ".env"', async () => {
        await quietly(async () => new NewCommand().start(['n', 'api', 'github', 'requireLogin']));
        const appDir: Path = path.join(workDir, 'api') as Path;
        // what a clone has: everything committed. ".env" is git ignored, and it is what the tests
        // would otherwise read their secrets from
        await FsUtilities.rm(path.join(appDir, '.env') as Path);

        // the first time anything runs a generated project's own tests - and the workflow's commands
        // as written, in order, so a step that only works on the machine that ran "zi new" fails here
        const workflow: string = await FsUtilities.readFile(path.join(appDir, '.github', 'workflows', 'ci.yml') as Path);
        for (const command of findWorkflowCommands(workflow)) {
            execSync(command, { cwd: appDir, stdio: 'pipe', shell: '/bin/bash' });
        }
    }, CI_WORKFLOW_TIMEOUT_MS);
});