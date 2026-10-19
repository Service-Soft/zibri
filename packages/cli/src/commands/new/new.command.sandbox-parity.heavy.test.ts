import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { NewCommand } from './new.command';
import { acceptedSandboxDifferences } from '../../__testing__/accepted-sandbox-differences';
import { diffFileContents } from '../../__testing__/diff-file-contents.function';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { GENERATED_FILE_PATHS, SANDBOX_DIR } from '../../__testing__/generated-file-paths';
import { normalizePackageJson } from '../../__testing__/normalize-package-json.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

/**
 * The same comparison `new.command.sandbox-parity.test.ts` makes in under two seconds, with the real
 * "npm install" the fast one stubs out.
 *
 * What only this can answer is `package.json`, because npm writes half of it. Every other file it
 * covers has already been judged by the time this runs - it is here so that the fast suite's one
 * assumption, that stubbing the install changes nothing else, is a claim something checks.
 */

// three installs rather than two: the harness goes in after the framework it peer depends on, so
// that npm resolves the peer to the copy this generator just installed rather than fetching one
const TEST_TIMEOUT_MS: number = 240_000;

describe('NewCommand (sandbox parity)', () => {
    let workDir: Path;
    let appDir: Path;

    beforeAll(async () => {
        workDir = await emptyWorkDirectory('sandbox-parity');
        appDir = path.join(workDir, 'sandbox') as Path;
        CPUtilities['cwd'] = workDir;
        // Local zibri link isn't needed for a file-content comparison, but this reuses the same
        // real "npm install" flow as the other heavy test so the generator runs exactly as it
        // would for a real user (see new.command.heavy.test.ts for why this flag exists).
        process.env['ZIBRI_CLI_LOCAL_DEV'] = '1';

        // no ci workflow, for the reason the fast parity suite gives
        await quietly(async () => new NewCommand().start(['n', 'sandbox', 'none', 'public']));
    }, TEST_TIMEOUT_MS);

    afterAll(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['ZIBRI_CLI_LOCAL_DEV'];
        await FsUtilities.rm(workDir);
    }, TEST_TIMEOUT_MS);

    it.each(GENERATED_FILE_PATHS)('matches packages/sandbox at %s', async relativePath => {
        const sandboxPath: Path = path.join(SANDBOX_DIR, relativePath) as Path;
        if (!await FsUtilities.exists(sandboxPath)) {
            throw new Error(`packages/sandbox is missing "${relativePath}", which "zi new" generates`);
        }

        // Read as raw buffers (not FsUtilities.readFile, which decodes as utf8 and would corrupt
        // binary assets like images).
        let generated: Buffer = await readFile(path.join(appDir, relativePath) as Path);
        let sandbox: Buffer = await readFile(sandboxPath);

        if (relativePath === 'package.json') {
            ({ generated, sandbox } = normalizePackageJson(generated, sandbox));
        }

        expect(diffFileContents(generated, sandbox)).toEqual(acceptedSandboxDifferences[relativePath] ?? '');
    });
});