import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { UpgradeCommand } from './upgrade.command';
import { version } from '../../../package.json';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { EVERY_FEATURE } from '../../__testing__/generated-file-paths';
import { mockExitGracefully, ProcessExitError } from '../../__testing__/mock-exit-gracefully.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities, GitUtilities, InquirerUtilities } from '../../encapsulation';
import { SCAFFOLD_FEATURES, SCAFFOLD_MANIFEST_FILE, ScaffoldManifest, ScaffoldUtilities } from '../../scaffold';
import { Path } from '../../utilities';
import { NewCommand } from '../new/new.command';

/**
 * How a project gets from one release of the generator to the next (round-2 07 §T5).
 *
 * Every case starts from a project `zi new` generated and committed, then makes one of its files
 * look like an older generator wrote it: the file, its id in the manifest and the commit all say
 * so. That is the whole difference an older release makes to a project, and it lets the generator
 * that runs here stand in for the newer one.
 */

const BUILD_STAGE: string = 'FROM node:24-slim AS build';

let workDir: Path;
let appDir: Path;
let execSpy: jest.SpiedFunction<typeof CPUtilities.exec>;

/**
 * Runs git in the generated project, with an identity of its own so no machine's configuration is needed.
 * @param args - The git command and its arguments.
 * @returns What it printed.
 */
function git(...args: string[]): string {
    return execFileSync(
        'git',
        ['-c', 'user.name=zi', '-c', 'user.email=zi@example.com', ...args],
        { cwd: appDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
}

/**
 * Commits everything in the project.
 * @param message - The commit message.
 */
function commitAll(message: string): void {
    git('add', '--all');
    git('commit', '--quiet', '--allow-empty', '--message', message);
}

/**
 * The project's file, as text.
 * @param relativePath - The file, relative to the project.
 * @returns Its content.
 */
async function read(relativePath: string): Promise<string> {
    return FsUtilities.readFile(path.join(appDir, relativePath) as Path);
}

/**
 * Overwrites one of the project's files.
 * @param relativePath - The file, relative to the project.
 * @param content - What it holds afterwards.
 */
async function write(relativePath: string, content: string): Promise<void> {
    await FsUtilities.writeFileBuffer(path.join(appDir, relativePath) as Path, Buffer.from(content));
}

/**
 * The project's manifest.
 * @returns It.
 */
async function manifestOf(): Promise<ScaffoldManifest> {
    const manifest: ScaffoldManifest | undefined = await ScaffoldUtilities.findManifest(appDir);
    assert(manifest, `the project has no ${SCAFFOLD_MANIFEST_FILE}`);
    return manifest;
}

/**
 * Makes a file of the project what an older generator wrote: its content, and its id in the manifest.
 * @param relativePath - The file, relative to the project.
 * @param content - What the older generator wrote, or undefined for a file it did not write at all.
 */
async function writeAsGenerated(relativePath: string, content: string | undefined): Promise<void> {
    const manifest: ScaffoldManifest = await manifestOf();
    const files: Record<string, string> = Object.fromEntries(Object.entries(manifest.files).filter(([file]) => file !== relativePath));
    if (content == undefined) {
        await FsUtilities.rm(path.join(appDir, relativePath) as Path);
    }
    else {
        files[relativePath] = GitUtilities.resolveBlobHash(Buffer.from(content));
        await write(relativePath, content);
    }
    await ScaffoldUtilities.writeManifest(appDir, { ...manifest, files });
}

/**
 * Runs `zi upgrade` in the project.
 * @param args - What follows the command on the command line.
 */
async function upgrade(...args: string[]): Promise<void> {
    await quietly(async () => new UpgradeCommand().start(['u', ...args]));
}

describe('UpgradeCommand', () => {

    beforeEach(async () => {
        // the machine's own git configuration stays out of it: a conflict style or a hook set there
        // would change what a merge writes, for this suite and for the command it runs
        process.env['GIT_CONFIG_GLOBAL'] = '/dev/null';
        process.env['GIT_CONFIG_NOSYSTEM'] = '1';
        workDir = await emptyWorkDirectory('upgrade-command');
        CPUtilities['cwd'] = workDir;
        execSpy = jest.spyOn(CPUtilities, 'exec').mockResolvedValue(undefined);
        await quietly(async () => new NewCommand().start(['n', 'api', 'none', 'requireLogin', EVERY_FEATURE]));

        appDir = path.join(workDir, 'api') as Path;
        CPUtilities['cwd'] = appDir;
        git('init', '--quiet');
        commitAll('zi new');
        execSpy.mockClear();
    });

    afterEach(async () => {
        CPUtilities['cwd'] = undefined;
        delete process.env['GIT_CONFIG_GLOBAL'];
        delete process.env['GIT_CONFIG_NOSYSTEM'];
        jest.restoreAllMocks();
        await FsUtilities.rm(workDir);
    });

    it('replaces a file the project never changed with what the generator writes now', async () => {
        const current: string = await read('Dockerfile');
        await writeAsGenerated('Dockerfile', current.replace(BUILD_STAGE, 'FROM node:22-slim AS build'));
        commitAll('zi new, an older one');

        await upgrade();

        expect(await read('Dockerfile')).toBe(current);
    });

    it('merges what the generator changed into a file the project changed elsewhere', async () => {
        const current: string = await read('Dockerfile');
        await writeAsGenerated('Dockerfile', current.replace(BUILD_STAGE, 'FROM node:22-slim AS build'));
        commitAll('zi new, an older one');
        await write('Dockerfile', (await read('Dockerfile')).replace('EXPOSE 3000', 'EXPOSE 8080'));
        commitAll('listens elsewhere');

        await upgrade();

        expect(await read('Dockerfile')).toBe(current.replace('EXPOSE 3000', 'EXPOSE 8080'));
    });

    it('marks both versions where the project and the generator changed the same lines', async () => {
        const current: string = await read('Dockerfile');
        await writeAsGenerated('Dockerfile', current.replace(BUILD_STAGE, 'FROM node:22-slim AS build'));
        commitAll('zi new, an older one');
        await write('Dockerfile', (await read('Dockerfile')).replace('FROM node:22-slim AS build', 'FROM node:20-slim AS build'));
        commitAll('an older node');

        await upgrade();

        // the way a git merge leaves a conflict, so resolving it is the same work as resolving one
        const merged: string = await read('Dockerfile');
        expect(merged).toMatch(/^<{7} .+\nFROM node:20-slim AS build\n={7}\nFROM node:24-slim AS build\n>{7} .+$/m);
    });

    it('writes the new version beside a changed file when the original is nowhere to be found', async () => {
        const current: string = await read('Dockerfile');
        // never committed, so the version the manifest names exists in no history to merge against
        await writeAsGenerated('Dockerfile', current.replace(BUILD_STAGE, 'FROM node:22-slim AS build'));
        const changed: string = (await read('Dockerfile')).replace('EXPOSE 3000', 'EXPOSE 8080');
        await write('Dockerfile', changed);

        await upgrade();

        expect(await read('Dockerfile')).toBe(changed);
        expect(await read(`Dockerfile${ScaffoldUtilities.BESIDE_SUFFIX}`)).toBe(current);
    });

    it('keeps a file the project deleted deleted', async () => {
        await FsUtilities.rm(path.join(appDir, 'src', 'cron', 'index.ts') as Path);
        commitAll('no cron jobs');

        await upgrade();

        expect(await FsUtilities.exists(path.join(appDir, 'src', 'cron', 'index.ts') as Path)).toBe(false);
    });

    it('adds a file the generator writes now and did not then', async () => {
        const current: string = await read('src/tsx.d.ts');
        await writeAsGenerated('src/tsx.d.ts', undefined);
        commitAll('zi new, an older one');

        await upgrade();

        expect(await read('src/tsx.d.ts')).toBe(current);
    });

    it('removes a file the generator no longer writes, unless the project changed it', async () => {
        await writeAsGenerated('src/obsolete.ts', 'export const obsolete: boolean = true;\n');
        await writeAsGenerated('src/also-obsolete.ts', 'export const obsolete: boolean = true;\n');
        commitAll('zi new, an older one');
        await write('src/also-obsolete.ts', 'export const obsolete: boolean = false;\n');
        commitAll('still in use');

        await upgrade();

        expect(await FsUtilities.exists(path.join(appDir, 'src', 'obsolete.ts') as Path)).toBe(false);
        expect(await read('src/also-obsolete.ts')).toBe('export const obsolete: boolean = false;\n');
    });

    it('records what it generated as the base of the next upgrade, which then has nothing to do', async () => {
        const current: string = await read('Dockerfile');
        await writeAsGenerated('Dockerfile', current.replace(BUILD_STAGE, 'FROM node:22-slim AS build'));
        await ScaffoldUtilities.writeManifest(appDir, { ...await manifestOf(), version: '3.0.0-older' });
        commitAll('zi new, an older one');

        await upgrade();
        const manifest: ScaffoldManifest = await manifestOf();
        commitAll('zi upgrade');
        await upgrade();

        expect(manifest.version).toBe(version);
        expect(manifest.files['Dockerfile']).toBe(GitUtilities.resolveBlobHash(Buffer.from(current)));
        expect(git('status', '--porcelain')).toBe('');
    });

    it('installs the framework at its own version, and what the generator now installs that the project lacks', async () => {
        const packageJson: { name: string, dependencies: Record<string, string>, devDependencies: Record<string, string> } = {
            name: 'api',
            dependencies: { zibri: '3.0.0', 'chart.js': '^4.5.1', 'ts-node': '^10.9.2' },
            devDependencies: { 'zibri-testing': '3.0.0', webpack: '^5.105.3', jest: '^30.4.2' }
        };
        await write('package.json', `${JSON.stringify(packageJson, undefined, 4)}\n`);
        commitAll('installed');

        await upgrade();

        const [dependencies, devDependencies]: string[] = execSpy.mock.calls.map(([command]) => command);
        expect(dependencies).toMatch(new RegExp(`^cd ${appDir} && npm i zibri@${version} `));
        expect(devDependencies).toMatch(new RegExp(`^cd ${appDir} && npm i -D zibri-testing@${version} `));
        // what the project has stays at the version it has, and what it lacks is what a new project gets
        expect(dependencies).toContain(' pg-query-stream@^4.10.3');
        expect(dependencies).not.toContain('chart.js');
        expect(dependencies).not.toContain('ts-node');
        expect(devDependencies).toContain(' ts-jest@^29.4.11');
        expect(devDependencies).not.toContain(' webpack@');
        expect(devDependencies).not.toContain(' jest@');
    });

    it('takes a manifest that records no features as one of a project with every feature', async () => {
        // what every cli before the features wrote, and every project it generated had all of them
        const { features, ...answers } = (await manifestOf()).answers;
        await FsUtilities.writeFileBuffer(
            path.join(appDir, SCAFFOLD_MANIFEST_FILE) as Path,
            Buffer.from(JSON.stringify({ ...await manifestOf(), answers }))
        );
        commitAll('zi new, before the features');

        await upgrade();

        expect((await manifestOf()).answers.features).toEqual(features);
        expect(git('status', '--porcelain')).toBe(` M ${SCAFFOLD_MANIFEST_FILE}\n`);
    });

    it('refuses a project a newer generator wrote, before changing anything', async () => {
        await ScaffoldUtilities.writeManifest(appDir, { ...await manifestOf(), version: '99.0.0' });
        commitAll('zi new, from the future');
        mockExitGracefully();

        await expect(upgrade()).rejects.toThrow(ProcessExitError);
        expect(execSpy).not.toHaveBeenCalled();
        expect(git('status', '--porcelain')).toBe('');
    });

    it('takes on a project without a manifest, asking what "zi new" would have, and merges nothing it cannot', async () => {
        const current: string = await read('Dockerfile');
        await FsUtilities.rm(path.join(appDir, SCAFFOLD_MANIFEST_FILE) as Path);
        await write('Dockerfile', current.replace('EXPOSE 3000', 'EXPOSE 8080'));
        commitAll('a project from before "zi upgrade"');
        const promptSpy: jest.SpiedFunction<typeof InquirerUtilities.prompt> = jest.spyOn(InquirerUtilities, 'prompt')
            .mockResolvedValueOnce({ ci: 'none' })
            .mockResolvedValueOnce({ defaultAuth: 'requireLogin' })
            .mockResolvedValueOnce({ features: SCAFFOLD_FEATURES });

        await upgrade();

        // the name is the package's, and the rest is what only the developer knows
        expect(promptSpy.mock.calls.map(([questions]) => Object.keys(questions))).toStrictEqual([['ci'], ['defaultAuth'], ['features']]);
        const manifest: ScaffoldManifest = await manifestOf();
        expect(manifest.answers).toEqual({ name: 'api', ci: 'none', defaultAuth: 'requireLogin', features: SCAFFOLD_FEATURES });
        // no record of what was generated, so a file that differs is the project's until somebody looks
        expect(await read('Dockerfile')).toBe(current.replace('EXPOSE 3000', 'EXPOSE 8080'));
        expect(await read(`Dockerfile${ScaffoldUtilities.BESIDE_SUFFIX}`)).toBe(current);
        expect(await FsUtilities.exists(path.join(appDir, `webpack.config.js${ScaffoldUtilities.BESIDE_SUFFIX}`) as Path)).toBe(false);
    });
});