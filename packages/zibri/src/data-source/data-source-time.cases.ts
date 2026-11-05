import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { dataSourceNow } from './models/data-source-now.function';
import { Repository } from './repository/repository';
import { runApplicationClockAhead } from '../__testing__/run-application-clock-ahead.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * The cases every data source answers the same way about `dataSourceNow`: what it writes and what it
 * compares with is the time on the data source's clock, however far the application's clock is off. A
 * file per data source runs them against a repository of its own.
 */

/**
 * A row stamped with a time.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Stamp extends BaseEntity {
    /**
     * Groups the stamps of one case, so the cases do not read rows of another.
     */
    @Property.string({ format: 'uuid' })
    batch!: string;

    /**
     * The time it is stamped with.
     */
    @Property.date()
    at!: Date;

    /**
     * A text that is not a date, which no time of the data source can be written to.
     */
    @Property.string({ required: false })
    label?: string;
}

/**
 * How far the application's clock runs ahead of the data source's in these cases.
 */
const SKEW_IN_MS: number = 10 * Ms.MINUTE;

/**
 * How far a stamp may be from the time the case expects: the clocks of the test machine and of a
 * container on it agree, and the rest is the time a statement takes.
 */
const TOLERANCE_IN_MS: number = 2 * Ms.SECOND;

/**
 * The time on the test machine's clock, which runs on while `Date` is run ahead, and which the data
 * source's clock agrees with.
 * @returns The time, in milliseconds.
 */
function findRealNow(): number {
    return performance.timeOrigin + performance.now();
}

/**
 * Checks that a date is a time of the data source the case expects.
 * @param date - The date.
 * @param from - What the real clock said before the call, in milliseconds.
 * @param to - What it said after.
 * @param plusInMs - The offset the call gave.
 */
function expectTimeBetween(date: Date, from: number, to: number, plusInMs: number): void {
    expect(date).toBeInstanceOf(Date);
    expect(date.getTime()).toBeGreaterThanOrEqual(from + plusInMs - TOLERANCE_IN_MS);
    expect(date.getTime()).toBeLessThanOrEqual(to + plusInMs + TOLERANCE_IN_MS);
}

/**
 * Runs every case against the stamps of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param stampsOf - Reads the repository, once the data source is started.
 */
export function describeDataSourceTime(dataSourceName: string, stampsOf: () => Repository<Stamp>): void {
    describe(`dataSourceNow, while the application's clock runs ahead, on ${dataSourceName}`, () => {
        afterEach(() => {
            jest.useRealTimers();
        });

        it('writes the time of the data source on create', async () => {
            const batch: string = UUIDUtilities.generate();
            runApplicationClockAhead(SKEW_IN_MS);
            const from: number = findRealNow();
            const stamp: Stamp = await stampsOf().create({ batch, at: dataSourceNow(Ms.MINUTE) });
            const to: number = findRealNow();

            expectTimeBetween(stamp.at, from, to, Ms.MINUTE);
            expect((await stampsOf().findById(stamp.id)).at).toEqual(stamp.at);
        });

        it('writes it on every row of createAll', async () => {
            const batch: string = UUIDUtilities.generate();
            runApplicationClockAhead(SKEW_IN_MS);
            const from: number = findRealNow();
            const stamps: Stamp[] = await stampsOf().createAll([{ batch, at: dataSourceNow() }, { batch, at: dataSourceNow(-Ms.MINUTE) }]);
            const to: number = findRealNow();

            expectTimeBetween(stamps[0]?.at ?? new Date(Number.NaN), from, to, 0);
            expectTimeBetween(stamps[1]?.at ?? new Date(Number.NaN), from, to, -Ms.MINUTE);
        });

        it('writes it on updateAll, and hands the rows back holding it', async () => {
            const batch: string = UUIDUtilities.generate();
            await stampsOf().create({ batch, at: new Date(0) });
            runApplicationClockAhead(SKEW_IN_MS);
            const from: number = findRealNow();
            const [updated] = await stampsOf().updateAll({ batch }, { at: dataSourceNow(Ms.MINUTE) }, { returnUpdated: true });
            const to: number = findRealNow();

            expectTimeBetween(updated?.at ?? new Date(Number.NaN), from, to, Ms.MINUTE);
            expectTimeBetween((await stampsOf().findOne({ where: { batch } })).at, from, to, Ms.MINUTE);
        });

        it('compares with it in a filter', async () => {
            const batch: string = UUIDUtilities.generate();
            const realNow: number = findRealNow();
            await stampsOf().createAll([
                { batch, at: new Date(realNow - Ms.MINUTE), label: 'past' },
                { batch, at: new Date(realNow + Ms.MINUTE), label: 'future' }
            ]);
            // far enough ahead that by the application's clock both are past
            runApplicationClockAhead(SKEW_IN_MS);

            const labelsWhere: (at: object) => Promise<(string | undefined)[]> = async at => {
                const found: Stamp[] = await stampsOf().findAll({ where: { batch, at } });
                return found.map(s => s.label).sort();
            };
            expect(await labelsWhere({ before: dataSourceNow() })).toEqual(['past']);
            expect(await labelsWhere({ after: dataSourceNow() })).toEqual(['future']);
            expect(await labelsWhere({ beforeOrOn: dataSourceNow(2 * Ms.MINUTE) })).toEqual(['future', 'past']);
            expect(await labelsWhere({ afterOrOn: dataSourceNow(-2 * Ms.MINUTE) })).toEqual(['future', 'past']);
            expect(await stampsOf().count({ where: { batch, at: { before: dataSourceNow() } } })).toBe(1);
        });

        it('deletes by it', async () => {
            const batch: string = UUIDUtilities.generate();
            const realNow: number = findRealNow();
            await stampsOf().createAll([
                { batch, at: new Date(realNow - Ms.MINUTE), label: 'past' },
                { batch, at: new Date(realNow + Ms.MINUTE), label: 'future' }
            ]);
            runApplicationClockAhead(SKEW_IN_MS);

            expect(await stampsOf().deleteAll({ batch, at: { before: dataSourceNow() } })).toBe(1);
            expect((await stampsOf().findAll({ where: { batch } })).map(s => s.label)).toEqual(['future']);
        });

        it('is refused for a property that holds no date', async () => {
            const batch: string = UUIDUtilities.generate();

            // @ts-expect-error a text property takes no time of the data source
            await expect(stampsOf().create({ batch, at: new Date(), label: dataSourceNow() })).rejects.toThrow('Stamp.label holds no date');
        });
    });
}