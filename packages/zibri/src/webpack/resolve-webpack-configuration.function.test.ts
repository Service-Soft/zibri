import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, afterEach, beforeAll, describe, expect, it } from '@jest/globals';
import { Configuration, validate } from 'webpack';

import { resolveWebpackConfiguration } from './resolve-webpack-configuration.function';
import { RestartServerOnBuildPlugin, WebpackStats } from './restart-server-on-build.plugin';
import { testFileFolder } from '../__testing__/constants';
import { waitUntil } from '../__testing__/wait-until.function';

/**
 * The build a generated project runs (round-2 07 §T5).
 *
 * It used to be written into every project by `zi new`, so a fix to it reached only the projects
 * generated after the fix. Shipped from here, `npm update` is what brings it.
 */

// the reference copy of a generated project, which the cli's parity suite holds equal to what `zi new` writes
const sandboxDir: string = path.resolve(__dirname, '..', '..', '..', 'sandbox');

/**
 * Where a copy plugin copies from.
 * @param plugin - A plugin of the configuration.
 * @returns The folders it copies, empty for any other plugin.
 */
function copiedFolders(plugin: unknown): string[] {
    // the plugin keeps its patterns to itself, so they are read the way any other field would be
    const patterns: unknown = plugin == undefined ? undefined : Reflect.get(plugin, 'patterns');
    if (!Array.isArray(patterns)) {
        return [];
    }
    return patterns.flatMap((pattern: unknown) => {
        const from: unknown = typeof pattern === 'object' && pattern != undefined ? Reflect.get(pattern, 'from') : undefined;
        return typeof from === 'string' ? [from] : [];
    });
}

/**
 * A compiler that finishes a build for every result it is given, the moment the plugin taps it.
 * @param watchMode - Whether the builds are those of `webpack --watch`.
 * @param results - Whether each build failed.
 * @returns The compiler.
 */
function compilerFinishing(watchMode: boolean, results: boolean[]): Parameters<RestartServerOnBuildPlugin['apply']>[0] {
    return {
        watchMode,
        hooks: {
            done: {
                tap: (_name: string, onDone: (stats: WebpackStats) => void) => {
                    for (const failed of results) {
                        onDone({ hasErrors: () => failed });
                    }
                }
            }
        }
    };
}

/**
 * A compiler in watch mode whose builds the test finishes one at a time.
 */
type SteppedCompiler = {
    /**
     * The compiler.
     */
    compiler: Parameters<RestartServerOnBuildPlugin['apply']>[0],
    /**
     * Finishes a build.
     */
    finishBuild: (failed: boolean) => void
};

/**
 * A compiler in watch mode whose builds the test finishes one at a time.
 * @returns The compiler, and what finishes a build of it.
 */
function steppedCompiler(): SteppedCompiler {
    const done: ((stats: WebpackStats) => void)[] = [];
    return {
        compiler: { watchMode: true, hooks: { done: { tap: (_name, onDone) => done.push(onDone) } } },
        finishBuild: failed => {
            for (const onDone of done) {
                onDone({ hasErrors: () => failed });
            }
        }
    };
}

describe('resolveWebpackConfiguration', () => {

    it('is a configuration webpack accepts', () => {
        const configuration: Configuration = resolveWebpackConfiguration({ root: sandboxDir });

        expect(() => validate(configuration)).not.toThrow();
    });

    it('builds the project it is given, wherever webpack was started from', () => {
        const configuration: Configuration = resolveWebpackConfiguration({ root: sandboxDir });

        // `npm run build -w api` starts webpack in the repository root of a monorepo
        expect(configuration.context).toBe(sandboxDir);
        expect(configuration.output?.path).toBe(path.join(sandboxDir, 'dist'));
    });

    it('copies only folders a generated project has', () => {
        const configuration: Configuration = resolveWebpackConfiguration({ root: sandboxDir });
        const copied: string[] = (configuration.plugins ?? []).flatMap(plugin => copiedFolders(plugin));

        expect(copied.length).toBeGreaterThan(0);
        // copy-webpack-plugin refuses a `from` that does not exist, so a folder it names and a new
        // project lacks is a project whose very first `npm run build` fails
        expect(copied.filter(from => !existsSync(from))).toEqual([]);
    });

    // round-2 08 §X14: a project generated without pages has no stylesheet, and none of the packages
    // that build one
    describe('for a project without a stylesheet', () => {
        const root: string = path.join(testFileFolder, 'webpack-without-stylesheet');

        beforeAll(async () => {
            for (const folder of [['assets', 'public'], ['src', 'templates'], ['translations']]) {
                await mkdir(path.join(root, ...folder), { recursive: true });
            }
            await writeFile(path.join(root, 'package.json'), '{ "name": "api" }');
        });

        afterAll(async () => {
            await rm(root, { recursive: true, force: true });
        });

        it('bundles the application alone, and is a configuration webpack accepts', () => {
            const configuration: Configuration = resolveWebpackConfiguration({ root });

            expect(configuration.entry).toEqual({ bundle: './src/index.ts' });
            expect(() => validate(configuration)).not.toThrow();
        });

        it('has no rule and no plugin for a stylesheet', () => {
            const configuration: Configuration = resolveWebpackConfiguration({ root });

            const tests: string[] = (configuration.module?.rules ?? [])
                .flatMap(rule => typeof rule === 'object' && rule != undefined && rule.test instanceof RegExp ? [rule.test.source] : []);
            expect(tests.some(test => test.includes('css'))).toBe(false);
            expect((configuration.plugins ?? []).map(plugin => plugin?.constructor.name)).not.toContain('MiniCssExtractPlugin');
        });
    });
});

describe('RestartServerOnBuildPlugin', () => {
    const root: string = path.join(testFileFolder, 'webpack-restart');
    const log: string = path.join(root, 'log.txt');

    /**
     * What the started applications wrote, a line each time one started or stopped.
     * @returns The lines.
     */
    async function readLog(): Promise<string[]> {
        return existsSync(log) ? (await readFile(log, 'utf8')).split('\n').filter(line => line.length) : [];
    }

    /**
     * Stops every application the log says is still running.
     */
    async function stopTheRest(): Promise<void> {
        const lines: string[] = await readLog();
        for (const line of lines.filter(l => l.startsWith('started '))) {
            const pid: string = line.slice('started '.length);
            if (!lines.includes(`stopped ${pid}`)) {
                process.kill(Number(pid), 'SIGKILL');
            }
        }
    }

    beforeAll(async () => {
        await mkdir(path.join(root, 'dist'), { recursive: true });
        // an application that takes a while to shut down, as one closing its connections does
        await writeFile(path.join(root, 'dist', 'bundle.js'), [
            'const fs = require(\'node:fs\');',
            `const log = ${JSON.stringify(log)};`,
            'fs.appendFileSync(log, `started ${process.pid}\\n`);',
            'process.on(\'SIGTERM\', () => setTimeout(() => {',
            '    fs.appendFileSync(log, `stopped ${process.pid}\\n`);',
            '    process.exit(0);',
            '}, 300));',
            'setInterval(() => {}, 1000);'
        ].join('\n'));
    });

    afterEach(async () => {
        await stopTheRest();
        await rm(log, { force: true });
    });

    afterAll(async () => {
        await rm(root, { recursive: true, force: true });
    });

    // what makes a restart start from empty registries: the rebuilt bundle is imported by a process of
    // its own, and the one holding the previous generation is stopped, so nothing is ever imported a
    // second time into the arrays a first import filled. Started only once the one before has exited:
    // a server still closing holds its port. It ran through a shell before, which a kill reached
    // in place of the server on a shell that does not exec its last command (round-2 11 §W1)
    it('starts the built application as a new process after every build, once the one before has stopped', async () => {
        const { compiler, finishBuild }: SteppedCompiler = steppedCompiler();
        new RestartServerOnBuildPlugin(root).apply(compiler);

        finishBuild(false);
        await waitUntil(async () => (await readLog()).length === 1);
        finishBuild(false);
        await waitUntil(async () => (await readLog()).filter(line => line.startsWith('started ')).length === 2);
        const [first, stopped, second] = await readLog();
        expect(stopped).toBe(first?.replace('started', 'stopped'));
        expect(second).toMatch(/^started \d+$/);
        expect(second).not.toBe(first);
    }, 15000);

    it('keeps the running application when a build fails, and starts nothing outside watch mode', async () => {
        new RestartServerOnBuildPlugin(root).apply(compilerFinishing(true, [false, true]));
        new RestartServerOnBuildPlugin(root).apply(compilerFinishing(false, [false]));

        await waitUntil(async () => (await readLog()).length > 0);
        // long enough for a second application to have started, were one started
        await wait(500);
        expect(await readLog()).toEqual([expect.stringMatching(/^started \d+$/)]);
    }, 15000);
});