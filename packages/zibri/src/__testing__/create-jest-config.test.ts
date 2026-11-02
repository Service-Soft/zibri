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
describe('createJestConfig', () => {

    it('compiles the es module only packages the framework loads, and the ones it is given', () => {
        const config: Config = createJestConfig({ rootDir: 'src', esmPackages: ['nanoid', '@scope/pkg'] });

        for (const file of ['/app/node_modules/jose/dist/index.js', '/app/node_modules/nanoid/index.js', '/app/node_modules/@scope/pkg/index.js']) {
            expect({ file, ignored: isIgnored(config, file), transformer: resolveTransformer(config, file) })
                .toEqual({ file, ignored: false, transformer: 'ts-jest' });
        }
        expect(isIgnored(config, '/app/node_modules/lodash/index.js')).toBe(true);
        // a name is a name, not a pattern: nanoid does not take nanoidx along
        expect(isIgnored(config, '/app/node_modules/nanoidx/index.js')).toBe(true);
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