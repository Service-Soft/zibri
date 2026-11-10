import { execFile } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { StatsCompilation } from 'webpack';

import { testFileFolder } from '../__testing__/constants';
import { JsonUtilities } from '../utilities/json.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';

const execFileAsync: (file: string, args: string[], options: { cwd: string, maxBuffer: number }) => Promise<unknown> = promisify(execFile);

const TIMEOUT: number = 300_000;

// the reference copy of a generated project, whose webpack.config.js loads the build of zibri, as an application's does:
// run `npm run build` before this
const sandboxDir: string = path.resolve(__dirname, '..', '..', '..', 'sandbox');

/**
 * What a build wrote, and what it compiled to write it.
 */
type BuildResult = {
    // the modules compiled, rather than taken from the cache
    built: number,
    errors: string[],
    bundle: string,
    map: string,
    stylesheet: string
};

/**
 * Builds a project as `npm run build` does, in a process of its own: Tailwind's PostCSS plugin hooks into the module
 * loader, which jest refuses inside a test. The cache is written as the process ends.
 * @param root - The project.
 * @returns What it wrote and compiled.
 */
async function build(root: string): Promise<BuildResult> {
    // beside the project, where Tailwind does not read it for classes
    const statsFile: string = `${root}-stats.json`;
    const cli: string = createRequire(path.join(root, 'package.json')).resolve('webpack-cli/bin/cli.js');
    try {
        await execFileAsync(process.execPath, [cli, `--json=${statsFile}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
    }
    catch {
        // a build with errors ends the process with a code other than 0, and still writes what it found
    }
    const json: StatsCompilation = JsonUtilities.parse<StatsCompilation>(await readFile(statsFile, 'utf8'));
    return {
        built: (json.modules ?? []).filter(module => module.built === true).length,
        errors: (json.errors ?? []).map(error => error.message),
        bundle: await readFile(path.join(root, 'dist', 'bundle.js'), 'utf8'),
        map: await readFile(path.join(root, 'dist', 'bundle.js.map'), 'utf8'),
        stylesheet: await readFile(path.join(root, 'dist', 'assets', 'public', 'style.css'), 'utf8')
    };
}

/**
 * Copies a project without what a build writes, its installed packages and its tests.
 * @param from - The project.
 * @param to - Where the copy goes.
 */
async function copyProject(from: string, to: string): Promise<void> {
    await mkdir(to, { recursive: true });
    for (const entry of await readdir(from, { withFileTypes: true })) {
        const source: string = path.join(from, entry.name);
        const target: string = path.join(to, entry.name);
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.endsWith('.test.ts')) {
            continue;
        }
        if (entry.isDirectory()) {
            await copyProject(source, target);
        }
        else if (entry.isFile()) {
            await copyFile(source, target);
        }
    }
}

/**
 * Changes a file of the project.
 * @param file - The file.
 * @param change - What it is to hold, given what it holds.
 */
async function change(file: string, change: (content: string) => string): Promise<void> {
    await writeFile(file, change(await readFile(file, 'utf8')));
}

describe('a build cached on disk', () => {
    const root: string = path.join(testFileFolder, `webpack-cache-${UUIDUtilities.generate()}`);
    let cold: BuildResult;

    beforeAll(async () => {
        // the sandbox without what a build writes or a test runs, its packages linked one by one, so the cache of the
        // copy is a folder of its own
        await copyProject(sandboxDir, root);
        await mkdir(path.join(root, 'node_modules'), { recursive: true });
        for (const entry of await readdir(path.join(sandboxDir, 'node_modules'))) {
            if (entry !== '.cache' && entry !== '.bin') {
                await symlink(path.join(sandboxDir, 'node_modules', entry), path.join(root, 'node_modules', entry));
            }
        }
        // a handlebars template the bundle renders, as an email of the application would
        await writeFile(path.join(root, 'src', 'templates', 'emails', 'greeting.hbs'), '<p>Hello {{name}}, from the first build</p>');
        await writeFile(path.join(root, 'src', 'greeting.ts'), [
            'import renderGreeting from \'./templates/emails/greeting.hbs\';',
            '',
            'export const greeting: string = renderGreeting({ name: \'Ada\' });'
        ].join('\n'));
        await change(path.join(root, 'src', 'index.ts'), content => `import './greeting';\n${content}`);
        // a repository of its own, as `zi new` makes one: Tailwind looks for classes in what its .gitignore leaves, which
        // inside the ignored output of the tests would be dist too, as of the second build
        await execFileAsync('git', ['init', '--quiet'], { cwd: root, maxBuffer: 1024 * 1024 });
        cold = await build(root);
    }, TIMEOUT);

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
        await rm(`${root}-stats.json`, { force: true });
    }, TIMEOUT);

    it('builds what it built before from the cache, into the same bundle, map and stylesheet', async () => {
        const warm: BuildResult = await build(root);

        expect(cold.errors).toEqual([]);
        expect(warm.built).toBeLessThan(cold.built / 10);
        expect(warm.bundle).toBe(cold.bundle);
        expect(warm.map).toBe(cold.map);
        expect(warm.stylesheet).toBe(cold.stylesheet);
        // the map names each source by its file, which an editor opens from a stack trace
        expect(warm.map).toContain(`file://${path.join(root, 'src', 'index.ts')}`);
    }, TIMEOUT);

    it('builds a changed template, page in markdown and handlebars template again, and the stylesheet with the classes', async () => {
        await change(path.join(root, 'src', 'templates', 'pages', 'home.tsx'), content => content.replace(
            '<Heading className="text-center">{appName}</Heading>',
            '<Heading className="text-center">{appName}</Heading><p className="text-[#123456]">A template changed after the first build</p>'
        ));
        await change(path.join(root, 'src', 'templates', 'docs', 'pages', 'getting-started.md'), content => `${content}\nA page changed after the first build.\n`);
        await change(path.join(root, 'src', 'templates', 'emails', 'greeting.hbs'), content => content.replace('from the first build', 'from a later build'));
        const changed: BuildResult = await build(root);

        expect(changed.errors).toEqual([]);
        expect(changed.bundle).toContain('A template changed after the first build');
        expect(changed.bundle).toContain('A page changed after the first build.');
        expect(changed.bundle).toContain('from a later build');
        expect(changed.stylesheet).toContain('#123456');
    }, TIMEOUT);

    // ts-loader reports the type errors of what it compiles, and the cache compiles only what changed
    it('reports a type error again in a build that takes its file from the cache', async () => {
        await change(path.join(root, 'src', 'greeting.ts'), content => `${content}\nexport const count: number = 'one';\n`);
        const first: BuildResult = await build(root);
        const again: BuildResult = await build(root);

        expect(first.errors.join('\n')).toContain('TS2322');
        expect(again.errors.join('\n')).toContain('TS2322');
    }, TIMEOUT);
});