/**
 * How much longer, or larger, a measurement may come out than the one it is compared with.
 */
const COMPARED_SLACK_RATIO: number = 1.1;

/**
 * A measurement of a backup as it is compared with another of the same suite.
 */
export type ComparedMeasurement = {
    /**
     * What it is called.
     */
    name: string,
    /**
     * The series it belongs to, undefined for a measurement of none.
     */
    series: string | undefined,
    /**
     * The series whose measurement of the same size it has to take no longer than and store no more than,
     * undefined for a measurement compared with none.
     */
    comparedWith: string | undefined,
    /**
     * How much data it starts with, in bytes.
     */
    dataBytes: number,
    /**
     * How long a backup of it takes, in milliseconds.
     */
    backupMs: number,
    /**
     * How long its restore takes, in milliseconds.
     */
    restoreMs: number,
    /**
     * What the transport holds after its backups, in bytes.
     */
    storedBytes: number
};

/**
 * A figure of a measurement that is more than it may be of the one it is compared with.
 */
export type ComparedViolation = {
    /**
     * Which figure, such as `restore`.
     */
    figure: string,
    /**
     * How many times the figure of the measurement it is compared with it is.
     */
    ratio: number,
    /**
     * The measurement it is compared with.
     */
    reference: ComparedMeasurement
};

/**
 * Compares the measurements of a suite of backups with each other.
 */
export abstract class BackupComparisonUtilities {
    /**
     * Finds where every measurement takes longer or stores more than the one of the same size it is compared
     * with, both times it is measured.
     *
     * A measurement and the one it is compared with are each taken in a process of its own, some time apart, on
     * a machine that does other things meanwhile: one of them off by chance is over the limit as much as one that
     * got slower is. So what is over the limit is measured again with what it is compared with, one right after
     * the other, and counts only when the same figure is over it then as well.
     * @param measurements - Every measurement of the suite.
     * @param measureAgain - Measures one of them again.
     * @returns One line per figure over the limit both times, and per measurement that has nothing to be
     * compared with.
     */
    static async findConfirmedViolations<T extends ComparedMeasurement>(
        measurements: T[],
        measureAgain: (measurement: T) => Promise<T>
    ): Promise<string[]> {
        const lines: string[] = [];
        for (const measurement of measurements) {
            const reference: T | undefined = this.findReference(measurement, measurements);
            if (measurement.comparedWith != undefined && reference == undefined) {
                lines.push(`${measurement.name}: nothing of "${measurement.comparedWith}" was measured at its size`);
                continue;
            }
            const before: ComparedViolation[] = this.findViolations(measurement, measurements);
            if (reference == undefined || !before.length) {
                continue;
            }
            const again: T = await measureAgain(measurement);
            const referenceAgain: T = await measureAgain(reference);
            for (const violation of this.findViolations(again, [again, referenceAgain])) {
                const violatedBefore: ComparedViolation | undefined = before.find(v => v.figure === violation.figure);
                if (violatedBefore != undefined) {
                    lines.push(
                        `${measurement.name}: ${violation.figure} ${violation.ratio.toFixed(2)}x of ${reference.name},`
                        + ` at most ${COMPARED_SLACK_RATIO}x, and ${violatedBefore.ratio.toFixed(2)}x when measured before`
                    );
                }
            }
        }
        return lines;
    }

    /**
     * Finds where a measurement takes longer or stores more than the measurement of the same size it is
     * compared with: its backups, its restore, and what the transport holds after them.
     * @param measurement - The measurement.
     * @param measurements - Every measurement, the one it is compared with among them.
     * @returns The figures over the limit, none for a measurement compared with nothing.
     */
    static findViolations(measurement: ComparedMeasurement, measurements: ComparedMeasurement[]): ComparedViolation[] {
        const reference: ComparedMeasurement | undefined = this.findReference(measurement, measurements);
        if (reference == undefined) {
            return [];
        }
        const figures: [string, (m: ComparedMeasurement) => number][] = [
            ['backup', m => m.backupMs],
            ['restore', m => m.restoreMs],
            ['stored bytes', m => m.storedBytes]
        ];
        return figures
            .map(([figure, read]) => ({ figure, ratio: read(measurement) / read(reference), reference }))
            .filter(violation => violation.ratio > COMPARED_SLACK_RATIO);
    }

    private static findReference<T extends ComparedMeasurement>(measurement: T, measurements: T[]): T | undefined {
        return measurement.comparedWith == undefined
            ? undefined
            : measurements.find(m => m.series === measurement.comparedWith && m.dataBytes === measurement.dataBytes);
    }
}