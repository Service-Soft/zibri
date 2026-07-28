import { Dirent, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { NewCommand } from './new.command';
import { acceptedSandboxDifferences } from '../../__testing__/accepted-sandbox-differences';
import { testFileFolder } from '../../__testing__/constants';
import { diffFileContents } from '../../__testing__/diff-file-contents.function';
import { normalizePackageJson } from '../../__testing__/normalize-package-json.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { getPath, Path } from '../../utilities';

const TEST_TIMEOUT_MS: number = 180_000;
const CLI_ROOT: string = path.join(__dirname, '..', '..', '..');
const SANDBOX_DIR: Path = path.join(__dirname, '..', '..', '..', '..', 'sandbox') as Path;
const RECORDED_DIFFS_PATH: Path = path.join(CLI_ROOT, 'src', '__testing__', 'recorded-sandbox-diffs.json') as Path;

const EXPLICITLY_CREATED_FILES: string[] = [
    'package.json',
    'tsconfig.json',
    'postcss.config.js',
    'tailwind.config.js',
    'webpack.config.js',
    'src/tsx.d.ts',
    'src/index.ts',
    'src/providers.ts',
    'src/create-default-data.function.ts',
    'src/data-sources/db/db.data-source.ts',
    'src/data-sources/db/migrations/index.ts',
    'src/data-sources/db/index.ts',
    'src/data-sources/index.ts',
    'src/repositories/index.ts',
    'src/repositories/user.repository.ts',
    'src/controllers/page.controller.ts',
    'src/controllers/index.ts',
    'src/models/index.ts',
    'src/models/generated/providers.ts',
    'src/models/roles.enum.ts',
    'src/models/user.model.ts',
    'src/cron/index.ts',
    'src/services/index.ts'
];

/**
 * Mirrors FsUtilities.copyDirectoryContent's ".tpl" stripping so the expected paths line up
 * with what "zi new" actually writes on disk.
 * @param sourceDir - The absolute directory to list (cli's own "assets" or "templates" folder).
 * @param destinationPrefix - The path prefix relative to the generated app root.
 * @returns The generated app's relative paths for every file under sourceDir.
 */
function listCopiedTemplateFiles(sourceDir: string, destinationPrefix: string): string[] {
    const entries: Dirent[] = readdirSync(sourceDir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const sourcePath: string = path.join(sourceDir, entry.name);
        const destName: string = entry.name.split('.tpl')[0];
        const destinationPath: string = `${destinationPrefix}/${destName}`;
        if (entry.isDirectory()) {
            files.push(...listCopiedTemplateFiles(sourcePath, destinationPath));
            continue;
        }
        files.push(destinationPath);
    }
    return files;
}

const GENERATED_FILE_PATHS: string[] = [
    ...EXPLICITLY_CREATED_FILES,
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'assets'), 'assets'),
    ...listCopiedTemplateFiles(path.join(CLI_ROOT, 'templates'), 'src/templates')
];

/**
 * Every file that really differs, together with its exact diff. Written to disk after the run so
 * that acceptedSandboxDifferences can be filled from it instead of by copying a diff out of the
 * test report, which mangles trailing whitespace and newlines.
 */
const recordedDifferences: Record<string, string> = {};

describe('NewCommand (sandbox parity)', () => {
    let workDir: Path;
    let appDir: Path;

    beforeAll(async () => {
        workDir = getPath(testFileFolder, 'sandbox-parity');
        appDir = path.join(workDir, 'sandbox') as Path;
        await FsUtilities.mkdir(workDir);
        CPUtilities['cwd'] = workDir;
        // Local zibri link isn't needed for a file-content comparison, but this reuses the same
        // real "npm install" flow as the other heavy test so the generator runs exactly as it
        // would for a real user (see new.command.heavy.test.ts for why this flag exists).
        process.env['ZIBRI_CLI_LOCAL_DEV'] = '1';

        await new NewCommand().start(['n', 'sandbox']);
    }, TEST_TIMEOUT_MS);

    afterAll(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['ZIBRI_CLI_LOCAL_DEV'];
        await FsUtilities.rm(workDir);
        // Re-records the fixture accepted-sandbox-differences.test.ts checks against, so that
        // filling acceptedSandboxDifferences never means copying a diff out of the test report.
        await (await FsUtilities.exists(RECORDED_DIFFS_PATH)
            ? FsUtilities.updateFile(RECORDED_DIFFS_PATH, `${JSON.stringify(recordedDifferences, undefined, 4)}\n`, 'replace')
            : FsUtilities.createFile(RECORDED_DIFFS_PATH, `${JSON.stringify(recordedDifferences, undefined, 4)}\n`));
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

        const diff: string = diffFileContents(generated, sandbox);
        if (diff !== '') {
            recordedDifferences[relativePath] = diff;
        }

        const accepted: string = acceptedSandboxDifferences[relativePath] ?? '';
        expect(diff).toEqual(accepted);
    });
});