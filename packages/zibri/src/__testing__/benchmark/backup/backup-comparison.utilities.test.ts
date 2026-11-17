import { describe, expect, it } from '@jest/globals';

import { BackupComparisonUtilities, ComparedMeasurement } from './backup-comparison.utilities';

/**
 * A measurement of 10 MB, as the comparison reads one.
 * @param series - Its series.
 * @param figures - What it took and stored, and what it is compared with.
 * @returns The measurement.
 */
function measured(
    series: string,
    figures: Partial<Pick<ComparedMeasurement, 'backupMs' | 'restoreMs' | 'storedBytes' | 'comparedWith' | 'dataBytes'>> = {}
): ComparedMeasurement {
    return {
        name: `10 MB ${series}`,
        series,
        comparedWith: undefined,
        dataBytes: 10_000_000,
        backupMs: 300,
        restoreMs: 1300,
        storedBytes: 10_000_000,
        ...figures
    };
}

/**
 * Hands out the given measurements in turn, as measuring again does, and notes which were asked for.
 * @param again - What measuring again finds, in the order it is asked.
 * @returns What measures again, and the names it was asked for.
 */
function measuringAgain(again: ComparedMeasurement[]): { measure: (m: ComparedMeasurement) => Promise<ComparedMeasurement>, asked: string[] } {
    const asked: string[] = [];
    let next: number = 0;
    return {
        asked,
        measure: async m => {
            asked.push(m.name);
            const found: ComparedMeasurement | undefined = again[next++];
            if (found == undefined) {
                throw new Error(`Nothing left to hand out for "${m.name}".`);
            }
            return await Promise.resolve(found);
        }
    };
}

// two measurements of a restore, each in a process of its own a minute and a half apart, were held to a tenth of
// each other, where the same one differed by nearly as much from one round to the next: a reference that came out
// faster failed the suite over a restore that had not changed
describe('BackupComparisonUtilities', () => {
    it('finds a measurement that takes longer or stores more than the one it is compared with, by more than a tenth', () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed');
        const within: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series, restoreMs: 1420 });
        const over: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series, restoreMs: 1440, storedBytes: 12_000_000 });

        expect(BackupComparisonUtilities.findViolations(within, [within, reference])).toStrictEqual([]);
        expect(BackupComparisonUtilities.findViolations(over, [over, reference]).map(v => v.figure)).toStrictEqual(['restore', 'stored bytes']);
        expect(BackupComparisonUtilities.findViolations(reference, [over, reference])).toStrictEqual([]);
    });

    it('measures nothing again when every measurement is within what it is compared with', async () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed');
        const within: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series });
        const again: ReturnType<typeof measuringAgain> = measuringAgain([]);

        expect(await BackupComparisonUtilities.findConfirmedViolations([within, reference], again.measure)).toStrictEqual([]);
        expect(again.asked).toStrictEqual([]);
    });

    it('measures both again, one right after the other, and lets through what is within the limit then', async () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed', { restoreMs: 1148 });
        const over: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series, restoreMs: 1277 });
        const again: ReturnType<typeof measuringAgain> = measuringAgain([
            measured('of postgres', { comparedWith: reference.series, restoreMs: 1260 }),
            measured('of postgres, dump compressed', { restoreMs: 1240 })
        ]);

        expect(await BackupComparisonUtilities.findConfirmedViolations([over, reference], again.measure)).toStrictEqual([]);
        expect(again.asked).toStrictEqual([over.name, reference.name]);
    });

    it('fails on what is over the limit both times, and says what it was each time', async () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed', { restoreMs: 1000 });
        const over: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series, restoreMs: 1300 });
        const again: ReturnType<typeof measuringAgain> = measuringAgain([
            measured('of postgres', { comparedWith: reference.series, restoreMs: 1250 }),
            measured('of postgres, dump compressed', { restoreMs: 1000 })
        ]);

        const confirmed: string = '10 MB of postgres: restore 1.25x of 10 MB of postgres, dump compressed, at most 1.1x,'
            + ' and 1.30x when measured before';
        expect(await BackupComparisonUtilities.findConfirmedViolations([over, reference], again.measure)).toStrictEqual([confirmed]);
    });

    // over the limit in another figure the second time is each of them over it once, which is what one measurement
    // off by chance looks like
    it('lets through what is over the limit in one figure the first time and in another the second', async () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed');
        const over: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series, restoreMs: 1500 });
        const again: ReturnType<typeof measuringAgain> = measuringAgain([
            measured('of postgres', { comparedWith: reference.series, backupMs: 400 }),
            measured('of postgres, dump compressed')
        ]);

        expect(await BackupComparisonUtilities.findConfirmedViolations([over, reference], again.measure)).toStrictEqual([]);
    });

    it('fails without measuring again when nothing of what a measurement is compared with was measured at its size', async () => {
        const reference: ComparedMeasurement = measured('of postgres, dump compressed', { dataBytes: 100_000_000 });
        const alone: ComparedMeasurement = measured('of postgres', { comparedWith: reference.series });
        const again: ReturnType<typeof measuringAgain> = measuringAgain([]);

        const missing: string = '10 MB of postgres: nothing of "of postgres, dump compressed" was measured at its size';
        expect(await BackupComparisonUtilities.findConfirmedViolations([alone, reference], again.measure)).toStrictEqual([missing]);
        expect(again.asked).toStrictEqual([]);
    });
});