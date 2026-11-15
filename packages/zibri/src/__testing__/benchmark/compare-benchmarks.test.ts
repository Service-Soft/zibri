import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { JsonUtilities } from '../../utilities/json.utilities';

/**
 * How `scripts/compare-benchmarks.mjs` decides, from the timings of both sides, whether a change made
 * the framework slower than the release it would replace. Building the release and running the suites
 * on it is left to the job: what is checked here is the verdict on what they measured.
 */

const scriptPath: string = path.resolve(__dirname, '..', '..', '..', 'scripts', 'compare-benchmarks.mjs');

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
 * Compares the rounds of both sides in the script's own process, since jest cannot load a module.
 * @param release - The rounds run on the release.
 * @param current - The rounds run on the checkout.
 * @param allowances - The allowances the repository records.
 * @param releaseVersion - The version of the release.
 * @param units
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
        const { resolveComparison } = await import('${pathToFileURL(scriptPath).href}');
        const args = ${JsonUtilities.stringify([release, current, allowances, releaseVersion, units])};
        console.log(JSON.stringify(resolveComparison(...args)));
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
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