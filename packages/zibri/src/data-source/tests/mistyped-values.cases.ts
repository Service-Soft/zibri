/* eslint-disable unicorn/no-null */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Where } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';
import { StoredValueTypeMismatchError } from '../stored-value-type-mismatch.error';

/**
 * The cases every data source answers the same way about a stored value that is not of the type its
 * property declares - which is what a declaration changed after the rows were written leaves behind.
 * A file per data source runs them against a repository of its own, writing the value past the
 * framework: going through the repository would mean asking validation to let it past, which would
 * test the way in rather than the way out.
 */

/**
 * What a gauge last read.
 */
export class GaugeReading {
    /**
     * The value read.
     */
    @Property.number({ required: false })
    value: number | undefined | null;

    /**
     * When it was read.
     */
    @Property.date({ required: false })
    takenAt: Date | undefined | null;

    /**
     * Whether the gauge was calibrated when it was read.
     */
    @Property.boolean({ required: false })
    calibrated: boolean | undefined | null;

    /**
     * Anything, compared as text.
     */
    @Property.string({ required: false })
    note: string | undefined | null;
}

/**
 * A row holding a number of its own and an object of values of every comparable type.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Gauge extends BaseEntity {
    /**
     * Which gauge, to tell the rows apart.
     */
    @Property.string()
    name!: string;

    /**
     * A number held by the row itself.
     */
    @Property.number({ required: false })
    level: number | undefined | null;

    /**
     * What it last read.
     */
    @Property.object({ cls: () => GaugeReading, required: false })
    reading: GaugeReading | undefined | null;
}

/**
 * What the cases run against.
 */
export type MistypedValueFixture = {
    /**
     * The gauges.
     */
    repository: Repository<Gauge>,
    /**
     * Writes the json a column of a row holds, past the framework.
     */
    overwrite: (id: string, column: 'reading' | 'level', json: string) => Promise<void>
};

/**
 * Seeds a gauge holding sensible values everywhere, one whose reading is then overwritten with values
 * of the wrong type, and one without a reading.
 * @param fixture - What to seed through.
 * @returns The id of the gauge holding the wrong types.
 */
async function seedGauges(fixture: MistypedValueFixture): Promise<string> {
    const reading: GaugeReading = { value: 5, takenAt: new Date('2024-03-01T10:00:00.000Z'), calibrated: true, note: 'ok' };
    await fixture.repository.deleteAll({});
    await fixture.repository.create({ name: 'fine', level: 1, reading });
    await fixture.repository.create({ name: 'no-reading', level: 1, reading: null });
    const mistyped: Gauge = await fixture.repository.create({ name: 'mistyped', level: 1, reading });
    return mistyped.id;
}

/**
 * The names of the gauges a filter finds, sorted.
 * @param repository - The gauges.
 * @param where - The filter.
 * @returns The names.
 */
async function findNames(repository: Repository<Gauge>, where: Where<Gauge>): Promise<string[]> {
    const found: Gauge[] = await repository.findAll({ where });
    return found.map(g => g.name).sort();
}

/**
 * Runs the cases about a value inside an object, which every data source can hold.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param fixtureOf - Reads the fixture, once the data source is started.
 */
export function describeMistypedValues(dataSourceName: string, fixtureOf: () => MistypedValueFixture): void {
    describe(`a stored value of another type than its property declares, on ${dataSourceName}`, () => {
        let mistypedId: string;

        beforeEach(async () => {
            mistypedId = await seedGauges(fixtureOf());
            await fixtureOf().overwrite(
                mistypedId,
                'reading',
                '{"value":"not-a-number","takenAt":"not-a-date","calibrated":"maybe","note":"ok"}'
            );
        }, 30000);

        it('names the property, the type it declares and the value that was found', async () => {
            const found: Promise<Gauge[]> = fixtureOf().repository.findAll({
                where: { reading: { where: { value: { greaterThan: 1 } } } }
            });

            await expect(found).rejects.toThrow(StoredValueTypeMismatchError);
            await expect(found).rejects.toThrow('Gauge.reading.value is declared as a number, but a row holds "not-a-number"');
        }, 30000);

        it.each<[string, Where<GaugeReading>]>([
            ['the value itself', { value: 5 }],
            ['"not"', { value: { not: 5 } }],
            ['"oneOf"', { value: { oneOf: [5] } }],
            ['"notOneOf"', { value: { notOneOf: [5] } }],
            ['an ordering', { value: { lesserThan: 10 } }]
        ])('refuses a comparison through %s', async (_name, where) => {
            // each of these reads the value as a number to answer, so none of them can say whether
            // the row matches - a quiet "no" would leave the row out of one answer and in the other
            await expect(fixtureOf().repository.findAll({ where: { reading: { where } } }))
                .rejects.toThrow(StoredValueTypeMismatchError);
        }, 30000);

        it('names a date and a boolean the same way', async () => {
            await expect(fixtureOf().repository.findAll({
                where: { reading: { where: { takenAt: { after: new Date(0) } } } }
            })).rejects.toThrow('Gauge.reading.takenAt is declared as a date, but a row holds "not-a-date"');
            await expect(fixtureOf().repository.findAll({
                where: { reading: { where: { calibrated: true } } }
            })).rejects.toThrow('Gauge.reading.calibrated is declared as a boolean, but a row holds "maybe"');
        }, 30000);

        it('answers whether there is a value without comparing it', async () => {
            // a value of any type is a value, so asking for one - or for none - has an answer
            expect(await findNames(fixtureOf().repository, { reading: { where: { value: { not: null } } } }))
                .toEqual(['fine', 'mistyped']);
            expect(await findNames(fixtureOf().repository, { reading: { where: { value: null } } }))
                .toEqual([]);
        }, 30000);

        it('leaves a filter that does not compare the mistyped property alone', async () => {
            // the row is only unreadable through the question that has to read that value, so a
            // filter on a property beside it still answers for every row including that one
            expect(await findNames(fixtureOf().repository, { reading: { where: { note: 'ok' } } }))
                .toEqual(['fine', 'mistyped']);
        }, 30000);

        it('hands the row back holding what is stored', async () => {
            const read: Gauge = await fixtureOf().repository.findById(mistypedId);

            // what the row holds rather than something made of it: NaN or an invalid date would be a
            // different value, and one nothing could tell from a real one
            expect(read.reading?.value).toBe('not-a-number');
            expect(read.reading?.takenAt).toBe('not-a-date');
            expect(read.reading?.calibrated).toBe('maybe');
        }, 30000);
    });
}

/**
 * Runs the cases about a value the row holds itself, for the data sources whose columns take a value
 * of any type.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param fixtureOf - Reads the fixture, once the data source is started.
 */
export function describeMistypedColumnValues(dataSourceName: string, fixtureOf: () => MistypedValueFixture): void {
    describe(`a column holding another type than its property declares, on ${dataSourceName}`, () => {
        let mistypedId: string;

        beforeEach(async () => {
            mistypedId = await seedGauges(fixtureOf());
            await fixtureOf().overwrite(mistypedId, 'level', '"not-a-number"');
        }, 30000);

        it('refuses a filter comparing it, naming the property', async () => {
            await expect(fixtureOf().repository.findAll({ where: { level: { greaterThan: 0 } } }))
                .rejects.toThrow('Gauge.level is declared as a number, but a row holds "not-a-number"');
        }, 30000);

        it('hands the row back holding what is stored', async () => {
            const read: Gauge = await fixtureOf().repository.findById(mistypedId);

            expect(read.level).toBe('not-a-number');
        }, 30000);
    });
}