import { execFileSync } from 'node:child_process';
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
    rows: { name: string, ratio: number | null, limit: number | null, verdict: 'ok' | 'slower' | 'new' }[],
    staleAllowances: BenchmarkAllowance[],
    failed: boolean
};

/**
 * Compares the rounds of both sides in the script's own process, since jest cannot load a module.
 * @param release - The rounds run on the release.
 * @param current - The rounds run on the checkout.
 * @param allowances - The allowances the repository records.
 * @param releaseVersion - The version of the release.
 * @returns The comparison.
 */
function compare(release: BenchmarkRound[], current: BenchmarkRound[], allowances: BenchmarkAllowance[], releaseVersion: string): BenchmarkComparison {
    const output: string = execFileSync(process.execPath, [
        '--input-type=module', '--eval', `
        const { resolveComparison } = await import('${pathToFileURL(scriptPath).href}');
        const args = ${JsonUtilities.stringify([release, current, allowances, releaseVersion])};
        console.log(JSON.stringify(resolveComparison(...args)));
    `
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return JsonUtilities.parse(output);
}

const rounds: (ms: number[]) => BenchmarkRound[] = ms => ms.map(value => ({ 'GET one row': value }));

describe('comparing the benchmarks with the release', () => {
    it('fails on an operation more than the limit slower than on the release, and passes one within it', () => {
        const slower: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.4, 1.4, 1.4, 1.4]), [], '3.0.0');
        const within: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), rounds([1.2, 1.2, 1.2, 1.2]), [], '3.0.0');

        expect(slower.rows).toMatchObject([{ name: 'GET one row', verdict: 'slower', limit: 1.3 }]);
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

    it('reports an operation the release does not measure without comparing it', () => {
        const comparison: BenchmarkComparison = compare(rounds([1, 1, 1, 1]), [1, 1, 1, 1].map(() => ({ 'GET one row': 1, 'POST one row': 9 })), [], '3.0.0');

        expect(comparison.rows).toMatchObject([{ name: 'GET one row', verdict: 'ok' }, { name: 'POST one row', verdict: 'new' }]);
        expect(comparison.rows[1]?.ratio).toBeNull();
        expect(comparison.failed).toBe(false);
    });
});