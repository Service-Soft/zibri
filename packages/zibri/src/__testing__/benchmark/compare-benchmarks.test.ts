import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { JsonUtilities } from '../../utilities/json.utilities';
import { testFileFolder } from '../constants';

/**
 * How `scripts/compare-benchmarks.mjs` decides, from the timings of both sides, whether a change made
 * the framework slower than the release it would replace. Building the release and running the suites
 * on it is left to the job: what is checked here is the verdict on what they measured.
 */

const packageDir: string = path.resolve(__dirname, '..', '..', '..');
const scriptPath: string = path.join(packageDir, 'scripts', 'compare-benchmarks.mjs');

/**
 * The median time of each operation in one run of the suites, by its name.
 */
type BenchmarkRound = Record<string, number>;

/**
 * A slowdown that was found to be worth it, for as long as the release it was measured against is the one compared with.
 */
type BenchmarkAllowance = {
    against: string,
    name: string,
    ratio: number,
    reason: string
};

/**
 * What the comparison answers.
 */
type BenchmarkComparison = {
    rows: { name: string, ratio: number | null, limit: number | null, verdict: 'ok' | 'worse' | 'new' }[],
    staleAllowances: BenchmarkAllowance[],
    failed: boolean
};

/**
 * One run of the suites as the comparison reads it from their reports: each measured value by its
 * name, and what each is counted in.
 */
type BenchmarkReadRound = {
    values: Record<string, number>,
    units: Record<string, string>
};

/**
 * The suites of each group a benchmark job's runner compares, by the group's name.
 */
type BenchmarkGroups = Record<string, string[]>;

/**
 * What a group's runner wrote: its comparison, by the group it compared.
 */
type BenchmarkGroupComparison = Omit<BenchmarkComparison, 'staleAllowances'> & {
    group: string,
    releaseVersion: string,
    units: Record<string, string>
};

/**
 * Calls one of the script's exports in the script's own process, since jest cannot load a module.
 * @param name - The export.
 * @param args - What it is called with.
 * @returns What it returned, or the message it threw with as `{ error }`.
 */
function callScript<T>(name: string, args: unknown[]): T | { error: string } {
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const script = await import('${pathToFileURL(scriptPath).href}');
        try {
            console.log(JSON.stringify(script[${JsonUtilities.stringify(name)}](...${JsonUtilities.stringify(args)}) ?? null));
        }
        catch (error) {
            console.log(JSON.stringify({ error: error.message }));
        }
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
}

/**
 * Compares the rounds of both sides as a run of every suite does: the verdict on each operation, and
 * the allowances that no longer apply.
 * @param release - The rounds run on the release.
 * @param current - The rounds run on the checkout.
 * @param allowances - The allowances the repository records.
 * @param releaseVersion - The version of the release.
 * @param units - What each value is counted in, by its name.
 * @returns The comparison.
 */
function compare(
    release: BenchmarkRound[],
    current: BenchmarkRound[],
    allowances: BenchmarkAllowance[],
    releaseVersion: string,
    units: Record<string, string> = {}
): BenchmarkComparison {
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const { resolveComparison, resolveStaleAllowances } = await import('${pathToFileURL(scriptPath).href}');
        const [release, current, allowances, releaseVersion, units] = ${JsonUtilities.stringify([release, current, allowances, releaseVersion, units])};
        const comparison = resolveComparison(release, current, allowances, releaseVersion, units);
        const staleAllowances = resolveStaleAllowances(allowances, comparison.rows, releaseVersion);
        console.log(JSON.stringify({ ...comparison, staleAllowances }));
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
}

/**
 * The benchmark suites of the framework, as paths relative to its package.
 * @param dir - The directory to look in, the framework's sources by default.
 * @returns The paths, with "/".
 */
function findBenchmarkSuites(dir: string = path.join(packageDir, 'src')): string[] {
    return readdirSync(dir, { withFileTypes: true })
        // not into the folder the suites write to, which the ones running beside this one change
        .filter(entry => path.join(dir, entry.name) !== testFileFolder)
        .flatMap(entry => {
            const entryPath: string = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                return findBenchmarkSuites(entryPath);
            }
            return entry.name.endsWith('.benchmark.test.ts')
                ? [
                    path.relative(packageDir, entryPath).split(path.sep)
                        .join('/')
                ]
                : [];
        });
}

/**
 * Reads the entries of one run's reports in the script's own process.
 * @param reports - The parsed content of each report file.
 * @returns The round.
 */
function readRound(reports: unknown[][]): BenchmarkReadRound {
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const { resolveRound } = await import('${pathToFileURL(scriptPath).href}');
        console.log(JSON.stringify(resolveRound(${JsonUtilities.stringify(reports)})));
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
}

const rounds: (ms: number[]) => BenchmarkRound[] = ms => ms.map(value => ({ 'GET one row': value }));

describe('comparing the benchmarks with the release', () => {
    // the release is run with its own jest configuration, and the one of 3.0.0 ignores every path
    // with `tmp` in it: under the system's temp directory its suites were found nowhere
    it('checks the release out beside the repository, where its own configuration finds its suites', () => {
        const output: string = execFileSync(process.execPath, [
            '--input-type=module', '--eval', `
            const { worktreeParent } = await import('${pathToFileURL(scriptPath).href}');
            console.log(JSON.stringify({ worktreeParent }));
        `
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        const { worktreeParent } = JsonUtilities.parse<{ worktreeParent: string }>(output);
        const repoRoot: string = path.resolve(__dirname, '..', '..', '..', '..', '..');

        expect(worktreeParent).toBe(path.dirname(repoRoot));
        expect(worktreeParent.startsWith(os.tmpdir())).toBe(false);
    });

    it('fails on an operation more than the limit slower than on the release, and passes one within it', () => {
        const slower: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.4, 1.4, 1.4, 1.4]), [], '3.0.0');
        const within: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.2, 1.2, 1.2, 1.2]), [], '3.0.0');

        expect(slower.rows).toMatchObject([{ name: 'GET one row', verdict: 'worse', limit: 1.3 }]);
        expect(slower.failed).toBe(true);
        expect(within.rows).toMatchObject([{ name: 'GET one row', verdict: 'ok' }]);
        expect(within.failed).toBe(false);
    });

    it('compares the medians of the rounds, so one slow round on either side decides nothing', () => {
        const comparison: BenchmarkComparison = compare(rounds([1, 1, 5, 1]), rounds([1, 5, 1, 1]), [], '3.0.0');

        expect(comparison.rows[0]?.ratio).toBe(1);
        expect(comparison.failed).toBe(false);
    });

    it('lets an allowance through for the release it was measured against, and for no other', () => {
        const allowance: BenchmarkAllowance = { against: '3.0.0', name: 'GET one row', ratio: 1.6, reason: 'validates the row it answers' };

        const allowed: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.5, 1.5, 1.5, 1.5]), [allowance], '3.0.0');
        const released: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.5, 1.5, 1.5, 1.5]), [allowance], '3.1.0');

        expect(allowed.failed).toBe(false);
        expect(allowed.staleAllowances).toStrictEqual([]);
        expect(released.failed).toBe(true);
        expect(released.staleAllowances).toStrictEqual([allowance]);
    });

    it('names an allowance the operation no longer needs', () => {
        const allowance: BenchmarkAllowance = { against: '3.0.0', name: 'GET one row', ratio: 1.6, reason: 'validates the row it answers' };

        const comparison: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.1, 1.1, 1.1, 1.1]), [allowance], '3.0.0');

        expect(comparison.failed).toBe(false);
        expect(comparison.staleAllowances).toStrictEqual([allowance]);
    });

    // only durations were compared, so a change that doubled what a backup holds in memory passed
    it('reads timings and figures from the reports, each with what it is counted in', () => {
        const round: BenchmarkReadRound = readRound([
            [{ timing: { name: 'GET one row', medianMs: 0.8, p95Ms: 1.1 }, baseline: undefined }],
            [{ figure: { name: 'peak memory of a backup', value: 52_000_000, unit: 'bytes' } }]
        ]);

        expect(round).toEqual({
            values: { 'GET one row': 0.8, 'peak memory of a backup': 52_000_000 },
            units: { 'GET one row': 'ms', 'peak memory of a backup': 'bytes' }
        });
    });

    it('fails on a figure more than the limit above the release, as on a timing', () => {
        const figure: (bytes: number[]) => BenchmarkRound[] = bytes => bytes.map(value => ({ 'peak memory of a backup': value }));

        const comparison: BenchmarkComparison = compare(figure([50, 50, 50, 50]), figure([80, 80, 80, 80]), [], '3.0.0');

        expect(comparison.rows).toMatchObject([{ name: 'peak memory of a backup', verdict: 'worse' }]);
        expect(comparison.failed).toBe(true);
    });

    // peak memory of a few dozen MiB moves by more than the ratio from one run to the next, with when
    // the collector happens to run
    it('passes memory within 16 MiB of the release whatever its ratio, and fails it beyond', () => {
        const mib: number = 1024 * 1024;
        const figure: (bytes: number) => BenchmarkRound[] = bytes => [1, 2, 3, 4].map(() => ({ 'peak memory of a backup': bytes }));
        const units: Record<string, string> = { 'peak memory of a backup': 'bytes' };

        const within: BenchmarkComparison = compare(figure(30 * mib), figure(42 * mib), [], '3.0.0', units);
        const beyond: BenchmarkComparison = compare(figure(30 * mib), figure(50 * mib), [], '3.0.0', units);

        expect(within.failed).toBe(false);
        expect(beyond.failed).toBe(true);
    });

    it('refuses two measurements of the same name, since neither could be compared', () => {
        expect(() => readRound([
            [{ timing: { name: 'GET one row', medianMs: 0.8, p95Ms: 1.1 } }],
            [{ figure: { name: 'GET one row', value: 3, unit: 'bytes' } }]
        ])).toThrow('Two benchmarks are named "GET one row"');
    });

    it('reports an operation the release does not measure without comparing it', () => {
        const comparison: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), [1, 1, 1, 1].map(() => ({ 'GET one row': 1, 'POST one row': 9 })), [], '3.0.0');

        expect(comparison.rows).toMatchObject([{ name: 'GET one row', verdict: 'ok' }, { name: 'POST one row', verdict: 'new' }]);
        expect(comparison.rows[1]?.ratio).toBeNull();
        expect(comparison.failed).toBe(false);
    });
});

describe('comparing the benchmarks in groups, each on a runner of its own', () => {
    const groups: BenchmarkGroups = {
        'val-key': ['src/val-key.benchmark.test.ts'],
        postgres: ['src/postgres.benchmark.test.ts']
    };

    const groupComparison: (group: string, rows: BenchmarkGroupComparison['rows']) => BenchmarkGroupComparison = (group, rows) => ({
        group,
        releaseVersion: '3.0.0',
        rows,
        failed: rows.some(row => row.verdict === 'worse'),
        units: {}
    });

    it('runs the suites of a group, and every suite no group names in the rest', () => {
        const suites: string[] = ['src/val-key.benchmark.test.ts', 'src/postgres.benchmark.test.ts', 'src/http.benchmark.test.ts'];

        expect(callScript('resolveGroupNames', [groups])).toStrictEqual(['val-key', 'postgres', 'rest']);
        expect(callScript('resolveGroupSuites', [groups, 'val-key', suites])).toStrictEqual(['src/val-key.benchmark.test.ts']);
        expect(callScript('resolveGroupSuites', [groups, 'rest', suites])).toStrictEqual(['src/http.benchmark.test.ts']);
    });

    // the release is grouped by the groups of the checkout: a suite it lacks is compared with nothing,
    // and one only it has is run in the rest, so that a group is never compared on two runners
    it('selects nothing of a group the side has no suite of', () => {
        expect(callScript('resolveGroupSuites', [groups, 'val-key', ['src/http.benchmark.test.ts']])).toStrictEqual([]);
    });

    it('refuses a group nobody declared', () => {
        expect(callScript('resolveGroupSuites', [groups, 'mysql', []])).toStrictEqual({
            error: 'There is no benchmark group "mysql", only val-key, postgres, rest.'
        });
    });

    it('refuses groups naming a suite that is gone, one suite twice, or the rest by name', () => {
        const result: unknown = callScript('validateGroups', [
            { 'val-key': ['src/val-key.benchmark.test.ts', 'src/gone.benchmark.test.ts'], other: ['src/val-key.benchmark.test.ts'], rest: [] },
            ['src/val-key.benchmark.test.ts']
        ]);

        expect(result).toMatchObject({ error: expect.stringContaining('"src/gone.benchmark.test.ts" is no benchmark suite of this checkout') });
        expect(result).toMatchObject({ error: expect.stringContaining('"src/val-key.benchmark.test.ts" is in more than one group') });
        expect(result).toMatchObject({ error: expect.stringContaining('"rest" is the group of every suite no other group names') });
    });

    it('groups the suites of this checkout as the job runs them', () => {
        const committed: BenchmarkGroups = JsonUtilities.parse(readFileSync(path.join(packageDir, 'benchmark-groups.json'), 'utf8'));

        expect(callScript('validateGroups', [committed, findBenchmarkSuites()])).toBeNull();
    });

    it('names an allowance stale only by the rows of every group, and fails when any group got worse', () => {
        const allowance: BenchmarkAllowance = { against: '3.0.0', name: 'GET one row', ratio: 1.6, reason: 'validates the row it answers' };
        const merged: unknown = callScript('resolveMergedComparison', [
            [
                groupComparison('val-key', [{ name: 'GET one row', ratio: 1.5, limit: 1.6, verdict: 'ok' }]),
                groupComparison('postgres', [{ name: 'POST one row', ratio: 1.4, limit: 1.3, verdict: 'worse' }]),
                groupComparison('rest', [])
            ],
            ['val-key', 'postgres', 'rest'],
            [allowance]
        ]);

        expect(merged).toMatchObject({ staleAllowances: [], failed: true });
    });

    it('fails when a group compared nothing', () => {
        expect(callScript('resolveMergedComparison', [[groupComparison('val-key', [])], ['val-key', 'postgres', 'rest'], []])).toStrictEqual({
            error: 'No comparison of postgres, rest: the job of each failed before it compared anything.'
        });
    });
});