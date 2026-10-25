import childProcess, { ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { Configuration, validate } from 'webpack';

import { resolveWebpackConfiguration } from './resolve-webpack-configuration.function';
import { RestartServerOnBuildPlugin, WebpackStats } from './restart-server-on-build.plugin';
import { testFileFolder } from '../__testing__/constants';

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
    let killed: number[];

    /**
     * Records every process the plugin starts instead of starting it.
     * @returns The spy, whose calls are the commands it was asked to run.
     */
    function recordingSpawn(): jest.SpiedFunction<typeof childProcess.spawn> {
        killed = [];
        return jest.spyOn(childProcess, 'spawn').mockImplementation(() => {
            const child: ChildProcess = new ChildProcess();
            const index: number = killed.push(0) - 1;
            jest.spyOn(child, 'kill').mockImplementation(() => {
                killed[index] = (killed[index] ?? 0) + 1;
                return true;
            });
            return child;
        });
    }

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('starts the built application as a new process after every build, stopping the one before', () => {
        const spawn: jest.SpiedFunction<typeof childProcess.spawn> = recordingSpawn();

        new RestartServerOnBuildPlugin().apply(compilerFinishing(true, [false, false]));

        // what makes a restart start from empty registries: the rebuilt bundle is imported by a process
        // of its own, and the one holding the previous generation is stopped, so nothing is ever
        // imported a second time into the arrays a first import filled
        expect(spawn.mock.calls.map(([command, args]) => [command, args])).toEqual([
            ['node', ['--enable-source-maps', 'dist/bundle.js']],
            ['node', ['--enable-source-maps', 'dist/bundle.js']]
        ]);
        expect(killed).toEqual([1, 0]);
    });

    it('keeps the running application when a build fails, and starts nothing outside watch mode', () => {
        const spawn: jest.SpiedFunction<typeof childProcess.spawn> = recordingSpawn();

        new RestartServerOnBuildPlugin().apply(compilerFinishing(true, [false, true]));
        new RestartServerOnBuildPlugin().apply(compilerFinishing(false, [false]));

        expect(spawn).toHaveBeenCalledTimes(1);
        expect(killed).toEqual([0]);
    });
});