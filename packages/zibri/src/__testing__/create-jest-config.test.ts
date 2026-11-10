import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import type { Config } from 'jest';

import { createJestConfig } from '../../../testing/src/create-jest-config.function';
import jestPreset from '../../../testing/src/jest-preset';

/**
 * The transformer jest picks for a file: the first pattern of `transform` that matches it.
 * @param config - The configuration.
 * @param file - The file's path.
 * @returns The transformer's name, undefined when no pattern matches.
 */
function resolveTransformer(config: Config, file: string): string | undefined {
    const match: [string, unknown] | undefined = Object.entries(config.transform ?? {}).find(([pattern]) => new RegExp(pattern).test(file));
    const transformer: unknown = Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
    return typeof transformer === 'string' ? transformer : undefined;
}

/**
 * Whether jest leaves a file as it is.
 * @param config - The configuration.
 * @param file - The file's path.
 * @returns True when one of `transformIgnorePatterns` matches it.
 */
function isIgnored(config: Config, file: string): boolean {
    return (config.transformIgnorePatterns ?? []).some(pattern => new RegExp(pattern).test(file));
}

/**
 * Jest requires what a test loads, and cannot require an es module. The preset compiles the one the
 * framework loads; a package of the application's own was added by restating the preset's ignore
 * pattern, which jest replaces rather than merges.
 */
/**
 * What the configuration does with a file, as jest sees it.
 */
type FileHandling = {
    file: string,
    /**
     * Whether jest leaves it as it is.
     */
    ignored: boolean,
    /**
     * The transformer jest hands it to, if any.
     */
    transformer: string | undefined
};

/**
 * What the configuration does with each file, built in a process of node run without `--experimental-vm-modules`, in
 * which jest cannot load an es module as it is.
 * @param files - The files.
 * @returns What it does with each.
 */
function resolveHandlingWithoutEsModules(files: string[]): FileHandling[] {
    const builtConfig: string = path.join(__dirname, '..', '..', '..', 'testing', 'dist', 'jest-config.js');
    const script: string = `
        const { createJestConfig } = require(${JSON.stringify(builtConfig)});
        const config = createJestConfig({ rootDir: 'src', esmPackages: ['nanoid', '@scope/pkg'] });
        const files = ${JSON.stringify(files)};
        process.stdout.write(JSON.stringify(files.map(file => {
            const match = Object.entries(config.transform).find(([pattern]) => new RegExp(pattern).test(file));
            const transformer = Array.isArray(match?.[1]) ? match[1][0] : match?.[1];
            const ignored = config.transformIgnorePatterns.some(pattern => new RegExp(pattern).test(file));
            return { file, ignored, transformer };
        })));
    `;
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } })) as FileHandling[];
}

describe('createJestConfig', () => {

    // node run without --experimental-vm-modules, such as by an editor starting jest on its own
    it('compiles the es module only packages the framework loads, and the ones it is given, when jest cannot load them as they are', () => {
        const compiled: string[] = ['/app/node_modules/jose/dist/index.js', '/app/node_modules/nanoid/index.js', '/app/node_modules/@scope/pkg/index.js'];
        // a name is a name, not a pattern: nanoid does not take nanoidx along
        const left: string[] = ['/app/node_modules/lodash/index.js', '/app/node_modules/nanoidx/index.js'];

        expect(resolveHandlingWithoutEsModules([...compiled, ...left])).toEqual([
            ...compiled.map(file => ({ file, ignored: false, transformer: 'ts-jest' })),
            ...left.map(file => ({ file, ignored: true }))
        ]);
    });

    // as the scripts of this repository and of a generated project run it: jest then loads such a package as it is, and
    // one compiled to commonjs it would still load as an es module, failing on `exports`
    it('leaves the es module only packages as they are when jest loads them so', () => {
        const config: Config = createJestConfig({ rootDir: 'src', esmPackages: ['nanoid'] });

        for (const file of ['/app/node_modules/jose/dist/index.js', '/app/node_modules/nanoid/index.js']) {
            expect({ file, ignored: isIgnored(config, file), transformer: resolveTransformer(config, file) })
                .toEqual({ file, ignored: true, transformer: undefined });
        }
    });

    it('keeps what the application sets beside it', () => {
        const config: Config = createJestConfig({
            rootDir: 'src',
            testTimeout: 10_000,
            transform: { '\\.graphql$': 'graphql-transformer' },
            moduleNameMapper: { '^@app/(.*)$': '<rootDir>/$1' }
        });

        expect(config.rootDir).toBe('src');
        expect(config.testTimeout).toBe(10_000);
        expect(resolveTransformer(config, '/app/src/schema.graphql')).toBe('graphql-transformer');
        expect(resolveTransformer(config, '/app/src/index.ts')).toBe('ts-jest');
        expect(config.moduleNameMapper).toEqual({ '^(.+)\\?client$': '$1', '^@app/(.*)$': '<rootDir>/$1' });
    });

    // a worker that has booted an application holds about a gigabyte and grows with every test file
    // that boots one, so a long run with a worker per core ended in the OOM killer
    it('restarts a worker that holds more than a gigabyte, unless the application sets its own limit', () => {
        expect(createJestConfig().workerIdleMemoryLimit).toBe('1GB');
        expect(createJestConfig({ workerIdleMemoryLimit: '2GB' }).workerIdleMemoryLimit).toBe('2GB');
    });

    it('is the preset when it is given nothing', () => {
        expect(createJestConfig()).toEqual(jestPreset);
    });
});