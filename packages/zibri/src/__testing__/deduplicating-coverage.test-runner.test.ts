import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { testFileFolder } from './constants';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * Where the package's jest configuration is.
 */
const PACKAGE_ROOT: string = path.join(__dirname, '..', '..');

/**
 * Two files that load the same modules of the framework: each boots an application of its own.
 */
const TEST_FILES: string[] = ['src/routing/router-orphaned-controller.test.ts', 'src/routing/router-overlapping-routes.test.ts'];

/**
 * Runs the test files with coverage in a jest of their own.
 * @param args - What the jest command line gets beyond that.
 * @returns How many megabytes of sources the run held after each file.
 */
function resolveSourcesHeldPerFile(...args: string[]): number[] {
    const coverageDirectory: string = path.join(testFileFolder, `deduplicating-coverage-${UUIDUtilities.generate()}`);
    try {
        const run: SpawnSyncReturns<string> = spawnSync(
            process.execPath,
            [
                require.resolve('jest/bin/jest'),
                ...TEST_FILES,
                // in workers: a run in band hands every file the same sources, the copies come with
                // what a worker sends back
                '--maxWorkers=2',
                '--coverage',
                `--coverageDirectory=${coverageDirectory}`,
                '--coverageReporters=json',
                '--reporters=default',
                '--reporters=<rootDir>/../scripts/coverage-memory.reporter.mjs',
                ...args
            ],
            { cwd: PACKAGE_ROOT, encoding: 'utf8' }
        );
        expect(run.status).toBe(0);
        return [...run.stderr.matchAll(/coverage memory: \d+ files, (\d+) MB of sources/g)].map(match => Number(match[1]));
    }
    finally {
        rmSync(coverageDirectory, { recursive: true, force: true });
    }
}

describe('DeduplicatingCoverageTestRunner', () => {
    // with jest's own runner, every file that loads the framework adds its sources once more, which
    // ran the process collecting coverage out of memory
    it('holds the sources of a module once, however many test files load it', () => {
        const [first, second] = resolveSourcesHeldPerFile();

        expect(first).toBeGreaterThan(0);
        expect(second).toBeLessThan(1.5 * (first ?? 0));
    }, 180_000);
});