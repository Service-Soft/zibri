import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';
import type { Config } from 'jest';

import { createJestConfig } from '../../../testing/src/create-jest-config.function';
import jestPreset from '../../../testing/src/jest-preset';
import { UUIDUtilities } from '../utilities/uuid.utilities';

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
 * What the configuration does with each file, built in a process of node of its own, so that the result does not
 * depend on how this suite is run.
 * @param files - The files.
 * @param nodeOptions - The options of that node: `--experimental-vm-modules` for one in which jest loads an es module
 * as it is, none for one in which it cannot.
 * @returns What it does with each.
 */
function resolveHandling(files: string[], nodeOptions: '' | '--experimental-vm-modules'): FileHandling[] {
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
    return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: nodeOptions } })) as FileHandling[];
}

describe('createJestConfig', () => {

    // node run without --experimental-vm-modules, such as by an editor starting jest on its own
    it('compiles the es module only packages the framework loads, and the ones it is given, when jest cannot load them as they are', () => {
        const compiled: string[] = [
            '/app/node_modules/jose/dist/index.js',
            '/app/node_modules/nanoid/index.js',
            '/app/node_modules/@scope/pkg/index.js',
            '/app/node_modules/fontkit/dist/node/index.js',
            // installed below the package that needs it, as npm does where the root holds another version
            '/app/node_modules/pdfmake-0.3/node_modules/fontkit/dist/node/index.js',
            '/app/node_modules/pdfmake-0.3/node_modules/@noble/hashes/sha2.js'
        ];
        // a name is a name, not a pattern: nanoid does not take nanoidx along
        const left: string[] = [
            '/app/node_modules/lodash/index.js',
            '/app/node_modules/nanoidx/index.js',
            '/app/node_modules/pdfmake-0.3/js/index.js',
            '/app/node_modules/pdfmake-0.3/node_modules/pdfkit/js/pdfkit.js'
        ];

        expect(resolveHandling([...compiled, ...left], '')).toEqual([
            ...compiled.map(file => ({ file, ignored: false, transformer: 'ts-jest' })),
            ...left.map(file => ({ file, ignored: true }))
        ]);
    });

    // an application's own test in a jest of its own, started without --experimental-vm-modules: pdfmake 0.3 stands on
    // packages that ship as es modules only, one of which reads its data by import.meta.url
    it('lets a test make a pdf with pdfmake 0.3 when jest cannot load es modules as they are', () => {
        const project: string = path.join(__dirname, 'file-output', `jest-pdfmake-${UUIDUtilities.generate()}`);
        const builtConfig: string = path.join(__dirname, '..', '..', '..', 'testing', 'dist', 'jest-config.js');
        // the cache of this suite, so that the packages compiled once stay compiled
        const cacheDirectory: string = path.join(__dirname, '..', '..', 'node_modules', '.cache', 'jest');
        mkdirSync(project, { recursive: true });
        try {
            writeFileSync(path.join(project, 'jest.config.cjs'), `
                const { createJestConfig } = require(${JSON.stringify(builtConfig)});
                module.exports = createJestConfig({
                    rootDir: __dirname,
                    testMatch: ['<rootDir>/*.app-test.cjs'],
                    cacheDirectory: ${JSON.stringify(cacheDirectory)}
                });
            `);
            writeFileSync(path.join(project, 'pdf.app-test.cjs'), `
                const path = require('node:path');
                const pdfmake = require('pdfmake-0.3');

                test('makes a pdf', async () => {
                    const fonts = path.join(path.dirname(require.resolve('pdfmake-0.3/package.json')), 'fonts', 'Roboto');
                    pdfmake.setFonts({ Roboto: {
                        normal: path.join(fonts, 'Roboto-Regular.ttf'),
                        bold: path.join(fonts, 'Roboto-Medium.ttf'),
                        italics: path.join(fonts, 'Roboto-Italic.ttf'),
                        bolditalics: path.join(fonts, 'Roboto-MediumItalic.ttf')
                    } });
                    pdfmake.setLocalAccessPolicy(() => true);
                    const pdf = await pdfmake.createPdf({ content: 'Grüße' }).getBuffer();
                    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
                });
            `);
            const run: SpawnSyncReturns<string> = spawnSync(
                process.execPath,
                [require.resolve('jest/bin/jest'), '--runInBand', '--ci', '--no-watchman', '--config', 'jest.config.cjs'],
                { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } }
            );

            expect({ status: run.status, output: run.stderr }).toEqual({ status: 0, output: expect.stringContaining('1 passed') });
        }
        finally {
            rmSync(project, { recursive: true, force: true });
        }
    }, 180_000);

    // as the scripts of this repository and of a generated project run it: jest then loads such a package as it is, and
    // one compiled to commonjs it would still load as an es module, failing on `exports`
    it('leaves the es module only packages as they are when jest loads them so', () => {
        const files: string[] = ['/app/node_modules/jose/dist/index.js', '/app/node_modules/nanoid/index.js'];

        expect(resolveHandling(files, '--experimental-vm-modules')).toEqual(files.map(file => ({ file, ignored: true })));
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
        // beside the mapping of a run that cannot load es modules as they are
        expect(config.moduleNameMapper).toEqual(expect.objectContaining({ '^(.+)\\?client$': '$1', '^@app/(.*)$': '<rootDir>/$1' }));
    });

    // a worker that has booted an application holds about a gigabyte and grows with every test file
    // that boots one, so a long run with a worker per core ended in the OOM killer
    it('restarts a worker that holds more than a gigabyte, unless the application sets its own limit', () => {
        expect(createJestConfig().workerIdleMemoryLimit).toBe('1GB');
        expect(createJestConfig({ workerIdleMemoryLimit: '2GB' }).workerIdleMemoryLimit).toBe('2GB');
    });

    // jest's default is the temp folder, which on many machines is a tmpfs: gigabytes of transformed
    // sources held in memory and swap, and gone after every reboot
    it('keeps its cache on the disk of the project, unless the application names another place', () => {
        expect(createJestConfig().cacheDirectory).toBe(path.join(process.cwd(), 'node_modules', '.cache', 'jest'));
        expect(createJestConfig({ cacheDirectory: '/elsewhere' }).cacheDirectory).toBe('/elsewhere');
    });

    it('is the preset when it is given nothing', () => {
        expect(createJestConfig()).toEqual(jestPreset);
    });
});