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
    rows: { name: string, ratio: number | null, limit: number | null, verdict: 'ok' | 'worse' | 'new' | 'gone' }[],
    staleAllowances: BenchmarkAllowance[],
    failed: boolean
};

/**
 * One run of the suites as the comparison reads it from their reports: each measured value by its
 * name, and what each is counted in.
 */
type BenchmarkReadRound = {
    values: Record<string, number>,
    units: Record<string, string>,
    slacks: Record<string, number>
};

/**
 * What a benchmark job's runner compares.
 */
type BenchmarkGroup = {
    /**
     * Its suites, as paths relative to the package.
     */
    suites: string[],
    /**
     * How often each side runs a suite both have, 4 unless given.
     */
    rounds?: number
};

/**
 * The group each runner of the benchmark job compares, by the group's name.
 */
type BenchmarkGroups = Record<string, BenchmarkGroup>;

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
 * @param slacks - How much more than on the release a value may be before its ratio counts, by its name.
 * @returns The comparison.
 */
function compare(
    release: BenchmarkRound[],
    current: BenchmarkRound[],
    allowances: BenchmarkAllowance[],
    releaseVersion: string,
    units: Record<string, string> = {},
    slacks: Record<string, number> = {}
): BenchmarkComparison {
    const args: string = JsonUtilities.stringify([release, current, allowances, releaseVersion, units, slacks]);
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const { resolveComparison, resolveStaleAllowances } = await import('${pathToFileURL(scriptPath).href}');
        const [release, current, allowances, releaseVersion, units, slacks] = ${args};
        const comparison = resolveComparison(release, current, allowances, releaseVersion, units, slacks);
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
            [
                { figure: { name: 'peak memory of a backup', value: 52_000_000, unit: 'bytes' } },
                { figure: { name: 'slowest answer during a backup', value: 9, unit: 'ms', slack: 10 } }
            ]
        ]);

        expect(round).toEqual({
            values: { 'GET one row': 0.8, 'peak memory of a backup': 52_000_000, 'slowest answer during a backup': 9 },
            units: { 'GET one row': 'ms', 'peak memory of a backup': 'bytes', 'slowest answer during a backup': 'ms' },
            slacks: { 'slowest answer during a backup': 10 }
        });
    });

    it('fails on a figure more than the limit above the release, as on a timing', () => {
        const figure: (bytes: number[]) => BenchmarkRound[] = bytes => bytes.map(value => ({ 'peak memory of a backup': value }));

        const comparison: BenchmarkComparison = compare(figure([50, 50, 50, 50]), figure([80, 80, 80, 80]), [], '3.0.0');

        expect(comparison.rows).toMatchObject([{ name: 'peak memory of a backup', verdict: 'worse' }]);
        expect(comparison.failed).toBe(true);
    });

    // what memory grows by over a phase moves by tens of MiB from one run to the next, with when the collector
    // runs and whether the pages freed before were kept: the same code on both sides came out 30 MiB apart
    it('passes memory within 64 MiB of the release whatever its ratio, and fails it beyond', () => {
        const mib: number = 1024 * 1024;
        const figure: (bytes: number) => BenchmarkRound[] = bytes => [1, 2, 3, 4].map(() => ({ 'peak memory of a backup': bytes }));
        const units: Record<string, string> = { 'peak memory of a backup': 'bytes' };

        const within: BenchmarkComparison = compare(figure(5 * mib), figure(65 * mib), [], '3.0.0', units);
        const beyond: BenchmarkComparison = compare(figure(5 * mib), figure(75 * mib), [], '3.0.0', units);

        expect(within.failed).toBe(false);
        expect(beyond.failed).toBe(true);
    });

    // the slowest of the answers of a server during a run is one answer, which a machine doing something else for
    // a moment doubles: the same code on both sides came out 6 ms apart, of 7
    it('passes a figure within the slack it names whatever its ratio, and fails it beyond', () => {
        const name: string = 'slowest answer during a backup';
        const figure: (ms: number) => BenchmarkRound[] = ms => [1, 2].map(() => ({ [name]: ms }));

        const within: BenchmarkComparison = compare(figure(7), figure(16), [], '3.0.0', { [name]: 'ms' }, { [name]: 10 });
        const beyond: BenchmarkComparison = compare(figure(7), figure(18), [], '3.0.0', { [name]: 'ms' }, { [name]: 10 });
        const withoutSlack: BenchmarkComparison = compare(figure(7), figure(16), [], '3.0.0', { [name]: 'ms' });

        expect(within.failed).toBe(false);
        expect(beyond.failed).toBe(true);
        expect(withoutSlack.failed).toBe(true);
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

    // the rows were those of the checkout alone, so an operation renamed here was gone from the table, and its new
    // name not measured on the release: a slowdown behind the rename showed nowhere
    it('reports an operation only the release measures as no longer measured, without failing', () => {
        const comparison: BenchmarkComparison = compare(
            [1, 1, 1, 1].map(() => ({ 'GET one row': 1, 'DELETE one row': 2 })),
            rounds([1, 1, 1, 1]),
            [],
            '3.0.0'
        );

        expect(comparison.rows).toMatchObject([{ name: 'GET one row', verdict: 'ok' }, { name: 'DELETE one row', verdict: 'gone', ratio: null }]);
        expect(comparison.failed).toBe(false);
        expect(callScript<string>('resolveTable', [comparison])).toContain('| DELETE one row | 2.000 ms | - | no longer measured here |');
    });

    // nothing divided by nothing is no number, which was within every limit and printed as one
    it('counts an operation that takes nothing on either side as unchanged, and one that takes something now as worse', () => {
        const unchanged: BenchmarkComparison = compare(rounds([0, 0, 0, 0]), rounds([0, 0, 0, 0]), [], '3.0.0');
        const worse: BenchmarkComparison = compare(rounds([0, 0, 0, 0]), rounds([1, 1, 1, 1]), [], '3.0.0');

        expect(unchanged.rows).toMatchObject([{ name: 'GET one row', verdict: 'ok', ratio: 1 }]);
        expect(callScript<string>('resolveTable', [unchanged])).toContain('| GET one row | 0.000 ms | 0.000 ms | 1.00x, limit 1.3x |');
        expect(worse.rows).toMatchObject([{ name: 'GET one row', verdict: 'worse' }]);
        expect(worse.failed).toBe(true);
    });
});

describe('comparing the benchmarks in groups, each on a runner of its own', () => {
    const groups: BenchmarkGroups = {
        'val-key': { suites: ['src/val-key.benchmark.test.ts'] },
        postgres: { suites: ['src/postgres.benchmark.test.ts'], rounds: 2 }
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
            {
                'val-key': { suites: ['src/val-key.benchmark.test.ts', 'src/gone.benchmark.test.ts'] },
                other: { suites: ['src/val-key.benchmark.test.ts'], rounds: 0 },
                rest: { suites: [] }
            },
            ['src/val-key.benchmark.test.ts']
        ]);

        expect(result).toMatchObject({ error: expect.stringContaining('"src/gone.benchmark.test.ts" is no benchmark suite of this checkout') });
        expect(result).toMatchObject({ error: expect.stringContaining('"src/val-key.benchmark.test.ts" is in more than one group') });
        expect(result).toMatchObject({ error: expect.stringContaining('"rest" is the group of every suite no other group names') });
        expect(result).toMatchObject({ error: expect.stringContaining('the rounds of "other" need to be a whole number of at least 1, not 0') });
    });

    // a suite that takes minutes, and takes the median of several backups and restores in each of its runs, is
    // compared in fewer rounds than one of an operation that takes a millisecond
    it('runs a group as often as it says, and four times when it says nothing', () => {
        expect(callScript('resolveGroupRounds', [groups, 'postgres'])).toBe(2);
        expect(callScript('resolveGroupRounds', [groups, 'val-key'])).toBe(4);
        expect(callScript('resolveGroupRounds', [groups, 'rest'])).toBe(4);
    });

    // every round ran every suite of both sides: one the release does not measure four times, to be compared with
    // nothing, which was most of what the job took while the release measured few of them
    it('runs a suite only one side has once, and one both have in every round', () => {
        const current: string[] = ['src/both.benchmark.test.ts', 'src/added.benchmark.test.ts'];
        const release: string[] = ['src/both.benchmark.test.ts', 'src/removed.benchmark.test.ts'];

        expect(callScript('resolveRoundSuites', [current, release, 0])).toStrictEqual({ current, release });
        expect(callScript('resolveRoundSuites', [current, release, 1])).toStrictEqual({
            current: ['src/both.benchmark.test.ts'],
            release: ['src/both.benchmark.test.ts']
        });
    });

    // nothing said which suite a job spent its half hour on, short of reading its log
    it('says what each run of a side took, and which suites it ran', () => {
        expect(callScript('resolveRunsTable', [
            [
                { label: 'round 1, release', suites: ['src/http.benchmark.test.ts'], seconds: 62 },
                { label: 'round 1, this checkout', suites: ['src/http.benchmark.test.ts', 'src/backup/backup.benchmark.test.ts'], seconds: 140 }
            ]
        ])).toBe([
            '| run | suites | took |',
            '|---|---|---|',
            '| round 1, release | http.benchmark.test.ts | 62 s |',
            '| round 1, this checkout | http.benchmark.test.ts, backup.benchmark.test.ts | 140 s |'
        ].join('\n'));
    });

    // the release is installed and built to be run: of a group it measures nothing of, for nothing
    it('reads the suites of the release off its files and its script, before it is built', () => {
        const script: string = 'node jest.js --runInBand --testPathPatterns="\\.benchmark\\.test\\.ts$"';
        const files: string[] = [
            'packages/zibri/src/http.benchmark.test.ts',
            'packages/zibri/src/http.test.ts',
            'packages/cli/src/cli.benchmark.test.ts',
            'packages/zibri/src/backup/backup.benchmark.test.ts'
        ];

        expect(callScript('resolveListedSuites', [files, script])).toStrictEqual(['src/backup/backup.benchmark.test.ts', 'src/http.benchmark.test.ts']);
        // a script that names its suites another way is asked by running it, once the release is built
        expect(callScript('resolveListedSuites', [files, 'node jest.js --config benchmark.config.js'])).toBeNull();
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