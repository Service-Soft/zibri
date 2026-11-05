import { DeploymentMeasurement } from './deployment-measurement.model';
import { FsUtilities } from '../encapsulation';
import { Path } from '../utilities';

/**
 * How much larger or slower than its baseline a measurement may be before the report says so. A
 * size moves only when something is added, so the margin is narrower than the one timings get.
 */
const GROWN_FROM_RATIO: number = 1.25;

/**
 * A measurement next to the one it is compared with.
 */
type DeploymentComparison = {
    /**
     * What this run measured.
     */
    measurement: DeploymentMeasurement,
    /**
     * What the baseline recorded for the same measurement, if it has one.
     */
    baseline: DeploymentMeasurement | undefined
};

/**
 * Compares what a built deployment measures with a recorded baseline.
 *
 * What it reports is never a failure: an image is built on one machine and started on another, and
 * a threshold that fails a run is either loose enough to catch nothing or tight enough to fail at
 * random. The report is what a release is read against.
 */
export abstract class DeploymentMeasurementUtilities {
    /**
     * Writes the measurements to the report, and to the baseline when asked to.
     * @param measurements - The measurements of this run.
     * @param reportPath - Where this run's report is written.
     * @param baselinePath - The recorded baseline, which is replaced by this run when `updateBaseline` is set.
     * @param updateBaseline - Whether this run becomes the baseline.
     * @returns The report as text, each measurement next to its baseline.
     */
    static async resolveReport(
        measurements: DeploymentMeasurement[],
        reportPath: Path,
        baselinePath: Path,
        updateBaseline: boolean
    ): Promise<string> {
        const baseline: DeploymentMeasurement[] = await FsUtilities.exists(baselinePath)
            ? JSON.parse(await FsUtilities.readFile(baselinePath)) as DeploymentMeasurement[]
            : [];
        const comparisons: DeploymentComparison[] = measurements.map(measurement => ({
            measurement,
            baseline: baseline.find(b => b.name === measurement.name)
        }));

        await this.writeFile(reportPath, JSON.stringify(comparisons, undefined, 4));
        if (updateBaseline) {
            await this.writeFile(baselinePath, JSON.stringify(measurements, undefined, 4));
        }
        return this.resolveTable(comparisons);
    }

    private static async writeFile(path: Path, content: string): Promise<void> {
        if (await FsUtilities.exists(path)) {
            await FsUtilities.updateFile(path, content, 'replace', false);
            return;
        }
        await FsUtilities.createFile(path, content, true, false);
    }

    private static resolveTable(comparisons: DeploymentComparison[]): string {
        const rows: string[] = comparisons.map(({ measurement, baseline }) => {
            const ratio: number | undefined = baseline == undefined ? undefined : measurement.value / baseline.value;
            const grown: string = measurement.unit === 'bytes' ? 'larger' : 'slower';
            const verdict: string = ratio == undefined
                ? 'no baseline'
                : ratio >= GROWN_FROM_RATIO ? `${ratio.toFixed(2)}x, ${grown}` : `${ratio.toFixed(2)}x`;
            return [
                measurement.name.padEnd(40),
                this.format(measurement).padStart(14),
                (baseline == undefined ? '-' : this.format(baseline)).padStart(14),
                `  ${verdict}`
            ].join('');
        });
        const heading: string = ['measurement'.padEnd(40), 'this run'.padStart(14), 'baseline'.padStart(14), '  against it'].join('');
        return [heading, ...rows].join('\n');
    }

    private static format(measurement: DeploymentMeasurement): string {
        return measurement.unit === 'bytes'
            ? `${(measurement.value / 1_000_000).toFixed(1)} MB`
            : `${(measurement.value / 1000).toFixed(1)} s`;
    }
}