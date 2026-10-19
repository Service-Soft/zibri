import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import ts from 'typescript';

import { NewCommand } from './new.command';
import { acceptedSandboxDifferences } from '../../__testing__/accepted-sandbox-differences';
import { testFileFolder } from '../../__testing__/constants';
import { diffFileContents } from '../../__testing__/diff-file-contents.function';
import { AUTHORED_CODE_PATHS,
    CLI_ROOT,
    GENERATED_FILE_PATHS,
    NEEDS_A_REAL_INSTALL,
    NOT_IN_VERSION_CONTROL,
    SANDBOX_DIR } from '../../__testing__/generated-file-paths';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { getPath, Path } from '../../utilities';

/**
 * Whether "zi new" still writes what packages/sandbox holds, in milliseconds.
 *
 * The same comparison the heavy suite makes, with the one expensive part of the generator - "npm
 * install" - stubbed out. Everything else it does is templating, so the tree this produces is the
 * real thing for every file npm does not touch, which is all of them but one.
 *
 * This exists because the fast check it replaces compared `acceptedSandboxDifferences` against a
 * recording the heavy suite had written on some earlier run. That could not tell a hand-written
 * entry being wrong from the generator having legitimately changed since - and after a green heavy
 * run the recording is the accepted list by construction, so it never had anything of its own to
 * say. Generating the diff is the only version of this check that is about the current code.
 */

const PARITY_TIMEOUT_MS: number = 30_000;
const COMPARED_FILE_PATHS: string[] = GENERATED_FILE_PATHS.filter(p => p !== NEEDS_A_REAL_INSTALL);
const RECORDED_DIFFS_PATH: Path = path.join(CLI_ROOT, 'src', '__testing__', 'recorded-sandbox-diffs.json') as Path;

/**
 * What this run actually saw, written out so that filling `acceptedSandboxDifferences` never means
 * copying a diff out of a test report - which silently drops trailing whitespace and turns newlines
 * into whatever line breaks the terminal chose.
 *
 * An aid, and nothing asserts against it. The check it replaces did assert against it, which made
 * it a snapshot that could be arbitrarily older than the code it was judging.
 */
const recordedDifferences: Record<string, string> = {};

/**
 * The variables a dotenv file declares, in the order it declares them.
 * @param content - The file to read.
 * @returns Every key, with comments and blank lines left out.
 */
function envKeysOf(content: string): string[] {
    return [...content.matchAll(/^([\dA-Z_]+)=/gm)].map(match => match[1]);
}

/**
 * The value a dotenv file gives one variable.
 * @param content - The file to read.
 * @param key - The variable to look up.
 * @returns Its value, or undefined when the file does not declare it.
 */
function envValueOf(content: string, key: string): string | undefined {
    return new RegExp(`^${key}=(.*)$`, 'm').exec(content)?.[1];
}

let workDir: Path;
let appDir: Path;

describe('NewCommand (sandbox parity, without installing)', () => {

    beforeAll(async () => {
        workDir = getPath(testFileFolder, 'sandbox-parity-fast');
        await FsUtilities.mkdir(workDir);
        CPUtilities['cwd'] = workDir;
        appDir = path.join(workDir, 'sandbox') as Path;

        // the only thing stubbed. `zi new` calls out twice, both times to npm, and neither call
        // writes a file this compares - so what is left running is the whole generator.
        jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        // no ci workflow: the sandbox lives inside this repository, whose own workflows are the ones
        // GitHub runs, so it has none of its own to compare against. new.command.test.ts reads the
        // generated one and the heavy suite runs it
        await quietly(async () => new NewCommand().start(['n', 'sandbox', 'none', 'public']));
    }, PARITY_TIMEOUT_MS);

    afterAll(async () => {
        CPUtilities['cwd'] = undefined;
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);

        const recording: string = `${JSON.stringify(recordedDifferences, undefined, 4)}\n`;
        await (await FsUtilities.exists(RECORDED_DIFFS_PATH)
            ? FsUtilities.updateFile(RECORDED_DIFFS_PATH, recording, 'replace')
            : FsUtilities.createFile(RECORDED_DIFFS_PATH, recording));
    }, PARITY_TIMEOUT_MS);

    it('creates every folder its own webpack config copies', async () => {
        const config: string = await FsUtilities.readFile(path.join(appDir, 'webpack.config.js') as Path);
        const copied: string[][] = [...config.matchAll(/from: path\.resolve\(__dirname, ([^)]+)\)/g)]
            .map(match => match[1].split(',').map(segment => segment.trim().replaceAll('\'', '')));

        expect(copied.length).toBeGreaterThan(0);

        const missing: string[] = [];
        for (const segments of copied) {
            if (!await FsUtilities.exists(path.join(appDir, ...segments) as Path)) {
                missing.push(segments.join('/'));
            }
        }

        // copy-webpack-plugin refuses a `from` that does not exist unless it is told not to, and the
        // generated config does not tell it - so a folder the generator names and never creates is a
        // project whose very first `npm run build` fails. Nothing compiled the scaffold, so nothing
        // said so.
        expect(missing).toEqual([]);
    }, PARITY_TIMEOUT_MS);

    it('generates code that parses', () => {
        // syntax only. Types would need the install this suite stubs out, and would answer a much
        // larger question than the one that went unasked: whether what the generator writes is
        // valid at all. It was not - `src/providers.ts` held an array element with no comma after
        // it, so every project ever generated had a file that could not be read, and the parity
        // suite carried the missing comma as an *accepted difference* from the sandbox.
        const program: ts.Program = ts.createProgram(
            AUTHORED_CODE_PATHS.map(relativePath => path.join(appDir, relativePath)),
            { allowJs: true, noEmit: true, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
        );

        const errors: string[] = program.getSyntacticDiagnostics().map(diagnostic => {
            const relativePath: string = path.relative(appDir, diagnostic.file.fileName);
            const message: string = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
            return `${relativePath}: ${message}`;
        });

        expect(errors).toEqual([]);
    }, PARITY_TIMEOUT_MS);

    it('ignores everything a project must not commit', async () => {
        const content: string = await FsUtilities.readFile(path.join(appDir, '.gitignore') as Path);
        const entries: string[] = content.split('\n')
            .map(line => line.trim())
            .filter(line => line !== '');

        // the install output and the build output, the secrets, and the folder
        // docs/creating-endpoints.md tells the reader to ignore - which nothing had been creating
        // for them. `versions` is deliberately absent: those snapshots are what the next version is
        // validated against, so they belong in the repository.
        expect(entries).toEqual(expect.arrayContaining(['node_modules', 'dist', '.env', '.zibri/']));
        expect(entries).not.toContain('versions');
    }, PARITY_TIMEOUT_MS);

    it('declares every environment variable it reads', async () => {
        const declared: string[] = envKeysOf(await FsUtilities.readFile(path.join(appDir, '.env.example') as Path));

        const read: Set<string> = new Set<string>();
        for (const relativePath of AUTHORED_CODE_PATHS) {
            const content: string = await FsUtilities.readFile(path.join(appDir, relativePath) as Path);
            // every form the scaffold reads one by: the helpers it names a variable through, and
            // process.env itself for anything reaching past them
            for (const match of content.matchAll(/(?:process\.env\[|requireEnv\(|requireBooleanEnv\(|optionalEnv\()'([\dA-Z_]+)'/g)) {
                read.add(match[1]);
            }
        }

        // both directions, because each is a way for a generated project to be wrong: a variable
        // the code reads and nothing documents is a boot failure nobody can explain, and one the
        // example declares and nothing reads is an instruction to set something that does nothing.
        expect([...read].sort()).toEqual([...declared].sort());
    }, PARITY_TIMEOUT_MS);

    it('answers every declared variable with a secret of this project\'s own', async () => {
        const examplePath: Path = path.join(appDir, '.env.example') as Path;
        const example: string = await FsUtilities.readFile(examplePath);
        const actual: string = await FsUtilities.readFile(path.join(appDir, NOT_IN_VERSION_CONTROL) as Path);

        expect(envKeysOf(actual).sort()).toEqual(envKeysOf(example).sort());

        // the point of generating this file rather than shipping one. Every value the CLI could
        // write into `.env.example` is published with the CLI, so an application left running on
        // one is signing its tokens with a key anyone can read off npm.
        for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'MASTER_KEY']) {
            const secret: string | undefined = envValueOf(actual, key);
            expect(secret).not.toEqual(envValueOf(example, key));
            expect(secret?.length).toBeGreaterThanOrEqual(32);
        }
    }, PARITY_TIMEOUT_MS);

    it.each(COMPARED_FILE_PATHS)('matches packages/sandbox at %s', async relativePath => {
        const sandboxPath: Path = path.join(SANDBOX_DIR, relativePath) as Path;
        if (!await FsUtilities.exists(sandboxPath)) {
            throw new Error(`packages/sandbox is missing "${relativePath}", which "zi new" generates`);
        }

        // raw buffers, because FsUtilities.readFile decodes as utf8 and would corrupt the images
        const generated: Buffer = await readFile(path.join(appDir, relativePath) as Path);
        const sandbox: Buffer = await readFile(sandboxPath);

        const diff: string = diffFileContents(generated, sandbox);
        if (diff !== '') {
            recordedDifferences[relativePath] = diff;
        }

        expect(diff).toEqual(acceptedSandboxDifferences[relativePath] ?? '');
    });
});