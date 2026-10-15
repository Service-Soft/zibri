import { performance } from 'node:perf_hooks';

import { BenchmarkTiming } from './benchmark-timing.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { JsonUtilities } from '../../utilities/json.utilities';

/**
 * How much slower than its baseline a timing may be before the report calls it slower. Wide on
 * purpose: a baseline is taken on one machine and compared on another, so only a change that costs
 * a multiple of what it did stands out from the difference between the two.
 */
const SLOWER_FROM_RATIO: number = 1.5;

/**
 * A timing next to the one it is compared with.
 */
type BenchmarkComparison = {
    timing: BenchmarkTiming,
    baseline: BenchmarkTiming | undefined
};

/**
 * Times operations and compares the timings with a recorded baseline.
 *
 * What it reports is never a failure. Timings depend on the machine and on whatever else it is doing,
 * so a threshold that fails a run is either loose enough to catch nothing or tight enough to fail at
 * random - what a call costs in round trips is what the counted suites gate on instead.
 */
export class BenchmarkUtilities {
    /**
     * Runs the work repeatedly and times each run.
     * @param name - What is measured, as the report names it.
     * @param runs - How many runs are timed. A tenth as many run first and are not timed, so that what
     * is measured is the code once the runtime has compiled it.
     * @param work - The work to time. Runs one at a time, never alongside itself.
     * @returns The timing.
     */
    static async resolveTiming(name: string, runs: number, work: () => Promise<unknown>): Promise<BenchmarkTiming> {
        for (let i: number = 0; i < Math.ceil(runs / 10); i++) {
            await work();
        }

        const durations: number[] = [];
        for (let i: number = 0; i < runs; i++) {
            const start: number = performance.now();
            await work();
            durations.push(performance.now() - start);
        }
        durations.sort((a, b) => a - b);
        return { name, medianMs: this.percentileOf(durations, 50), p95Ms: this.percentileOf(durations, 95) };
    }

    /**
     * Writes the timings to the report, and to the baseline when asked to.
     * @param timings - The timings of this run.
     * @param reportPath - Where this run's report is written.
     * @param baselinePath - The recorded baseline, which is replaced by this run when `updateBaseline` is set.
     * @param updateBaseline - Whether this run becomes the baseline.
     * @returns The report as text, each timing next to its baseline.
     */
    static async resolveReport(
        timings: BenchmarkTiming[],
        reportPath: FsPath,
        baselinePath: FsPath,
        updateBaseline: boolean
    ): Promise<string> {
        const baseline: BenchmarkTiming[] = await FsUtilities.exists(baselinePath)
            ? JsonUtilities.parse<BenchmarkTiming[]>(await FsUtilities.readFile(baselinePath))
            : [];
        const comparisons: BenchmarkComparison[] = timings.map(timing => ({
            timing,
            baseline: baseline.find(b => b.name === timing.name)
        }));

        await FsUtilities.upsertFile(reportPath, JsonUtilities.stringify(comparisons, undefined, 4));
        if (updateBaseline) {
            await FsUtilities.upsertFile(baselinePath, JsonUtilities.stringify(timings, undefined, 4));
        }
        return this.resolveTable(comparisons);
    }

    private static percentileOf(sorted: number[], percentile: number): number {
        const index: number = Math.min(sorted.length - 1, Math.ceil((percentile / 100) * sorted.length) - 1);
        return sorted[Math.max(0, index)] ?? Number.NaN;
    }

    private static resolveTable(comparisons: BenchmarkComparison[]): string {
        const rows: string[] = comparisons.map(({ timing, baseline }) => {
            const ratio: number | undefined = baseline == undefined ? undefined : timing.medianMs / baseline.medianMs;
            const verdict: string = ratio == undefined
                ? 'no baseline'
                : ratio >= SLOWER_FROM_RATIO ? `${ratio.toFixed(2)}x, slower` : `${ratio.toFixed(2)}x`;
            return [
                timing.name.padEnd(40),
                `${timing.medianMs.toFixed(3)} ms`.padStart(12),
                `${timing.p95Ms.toFixed(3)} ms`.padStart(12),
                (baseline == undefined ? '-' : `${baseline.medianMs.toFixed(3)} ms`).padStart(12),
                `  ${verdict}`
            ].join('');
        });
        const heading: string = [
            'operation'.padEnd(40),
            'median'.padStart(12),
            'p95'.padStart(12),
            'baseline'.padStart(12),
            '  against it'
        ].join('');
        return [heading, ...rows].join('\n');
    }
}