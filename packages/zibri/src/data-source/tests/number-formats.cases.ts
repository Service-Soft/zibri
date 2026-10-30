import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { BigNumber } from '../../utilities/number.utilities';
import { KeysetPage } from '../models/pagination-result.model';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about what a number property is read back and
 * compared as. A file per data source runs them against a repository of its own.
 */

/**
 * A whole number one past what a double can tell apart.
 *
 * `Number(9007199254740993)` is 9007199254740992, so a store that reads this back through a double
 * hands back a different number without saying so.
 */
const pastSafeInteger: bigint = 9007199254740993n;

/**
 * A price with more digits than a double holds exactly.
 */
const exactDecimal: string = '12345678901234567890.123456789';

/**
 * A row holding one number of every format.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
export class Measurement extends BaseEntity {
    /**
     * A plain number.
     */
    @Property.number()
    temperature!: number;

    /**
     * A whole number.
     */
    @Property.number({ format: 'integer' })
    readings!: number;

    /**
     * A whole number past what a double holds.
     */
    @Property.number({ format: 'bigint' })
    sequence!: bigint;

    /**
     * An exact decimal, looked up by an index.
     */
    @Property.number({ format: 'bignumber', index: true })
    price!: BigNumber;
}

/**
 * Runs every case against the repository of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param repositoryOf - Reads the repository, once the data source is started.
 */
export function describeNumberFormats(dataSourceName: string, repositoryOf: () => Repository<Measurement>): void {
    describe(`what a number property is read back as, on ${dataSourceName}`, () => {
        it('hands each kind back as the type its property declares', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            const created: Measurement = await repository.create({
                temperature: 21.5,
                readings: 12,
                sequence: pastSafeInteger,
                price: new BigNumber(exactDecimal)
            });

            const read: Measurement = await repository.findById(created.id);

            expect(typeof read.temperature).toBe('number');
            expect(typeof read.readings).toBe('number');
            expect(typeof read.sequence).toBe('bigint');
            expect(read.price).toBeInstanceOf(BigNumber);

            expect(read.temperature).toBe(21.5);
            expect(read.readings).toBe(12);
            // every format is stored as something its type holds exactly, so a value written is the
            // value read - which is what a decimal column read back through Number could not promise
            expect(read.sequence).toBe(pastSafeInteger);
            expect(read.price.toFixed()).toBe(exactDecimal);
        }, 30000);

        it('holds every whole number a double holds exactly as a whole number', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            // a time in milliseconds, which is past what 32 bits hold, and the largest whole number
            // the format takes
            const inMilliseconds: Measurement = await repository.create({
                temperature: 1,
                readings: 1760000000000,
                sequence: 1n,
                price: new BigNumber(1)
            });
            const smallest: Measurement = await repository.create({
                temperature: 1,
                readings: -Number.MAX_SAFE_INTEGER,
                sequence: 1n,
                price: new BigNumber(1)
            });

            expect((await repository.findById(inMilliseconds.id)).readings).toBe(1760000000000);
            expect((await repository.findById(smallest.id)).readings).toBe(-Number.MAX_SAFE_INTEGER);
            expect(await repository.findAll({ where: { readings: { greaterThan: 2 ** 31 } } })).toHaveLength(1);
        }, 30000);

        it('compares an exact decimal by its value rather than as an object', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            await repository.create({
                temperature: 1,
                readings: 1,
                sequence: 1n,
                price: new BigNumber('10.5')
            });

            // a BigNumber is an object, so a filter comparing it with `<` would be comparing what it
            // stringifies to, and one comparing it with `===` would be comparing which object it is
            expect(await repository.findAll({ where: { price: new BigNumber('10.5') } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: { greaterThan: new BigNumber(10) } } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: { greaterThan: new BigNumber(11) } } })).toHaveLength(0);
        }, 30000);

        it('takes a bound on an exact decimal written as any number that fits in one', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            await repository.create({
                temperature: 1,
                readings: 1,
                sequence: 1n,
                price: new BigNumber('10.5')
            });

            // a filter compares rather than stores, and every javascript number and every bigint fits
            // in an exact decimal - so a bound may be written as the literal it reads as. What this
            // spares is `new BigNumber(0)` on every "cannot be negative" filter anyone writes
            expect(await repository.findAll({ where: { price: { greaterThanEquals: 0 } } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: { greaterThan: 10 } } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: { greaterThan: 11 } } })).toHaveLength(0);
            expect(await repository.findAll({ where: { price: { lesserThan: 10n } } })).toHaveLength(0);
            expect(await repository.findAll({ where: { price: { lesserThan: 11n } } })).toHaveLength(1);
        }, 30000);

        // 11 §S6: a store looking an indexed exact decimal up named the entry of the number as it was
        // written in the filter, which is not the entry of the decimal it equals
        it('finds an exact decimal by any number that equals it, through its index too', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            await repository.createAll([
                { temperature: 1, readings: 1, sequence: 1n, price: new BigNumber(10) },
                { temperature: 1, readings: 1, sequence: 1n, price: new BigNumber('10.5') }
            ]);

            expect(await repository.findAll({ where: { price: 10 } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: 10n } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: 10.5 } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: new BigNumber('10.50') } })).toHaveLength(1);
            expect(await repository.findAll({ where: { price: { oneOf: [10, new BigNumber('10.5')] } } })).toHaveLength(2);
        }, 30000);

        it('compares a bigint against the whole numbers it holds', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            await repository.create({
                temperature: 1,
                readings: 1,
                sequence: pastSafeInteger,
                price: new BigNumber(1)
            });

            expect(await repository.findAll({ where: { sequence: pastSafeInteger } })).toHaveLength(1);
            expect(await repository.findAll({ where: { sequence: { greaterThan: 9007199254740992n } } })).toHaveLength(1);
            expect(await repository.findAll({ where: { sequence: { lesserThan: 9007199254740992n } } })).toHaveLength(0);
        }, 30000);
    });

    // 01 §D9: the cursor carried only strings, numbers and booleans, so the first full page of a walk
    // ordered by a bigint or an exact decimal ended in an error - and read back through Number, a
    // cursor past what a double holds would have named a different row
    describe(`a keyset walk ordered by a number past what a double holds, on ${dataSourceName}`, () => {
        it('walks a bigint order once over every row', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            // next to each other past 2^53, where a double holds only every second whole number
            const sequences: bigint[] = [0n, 1n, 2n, 3n, 4n, 5n].map(i => pastSafeInteger + i);
            await repository.createAll(sequences.map(sequence => ({ temperature: 1, readings: 1, sequence, price: new BigNumber(1) })));

            const walked: bigint[] = [];
            let cursor: string | undefined;
            do {
                const page: KeysetPage<Measurement> = await repository.findAllAfter(cursor, 2, { order: { sequence: 'ASC' } });
                walked.push(...page.items.map(m => m.sequence));
                cursor = page.nextCursor;
            }
            while (cursor != undefined);

            expect(walked).toEqual(sequences);
        }, 30000);

        it('orders exact decimals by their value, not by how they are written', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            await repository.createAll(['9', '10', '-1', '-2', '9.5'].map(price => ({
                temperature: 1,
                readings: 1,
                sequence: 1n,
                price: new BigNumber(price)
            })));

            const ordered: Measurement[] = await repository.findAll({ order: { price: 'ASC' } });

            expect(ordered.map(m => m.price.toFixed())).toEqual(['-2', '-1', '9', '9.5', '10']);
        }, 30000);

        it('walks an exact decimal order once over every row', async () => {
            const repository: Repository<Measurement> = repositoryOf();
            await repository.deleteAll({});
            // apart only in digits a double does not hold
            const prices: string[] = ['0.3', '0.2', '0.1'].map(fraction => `${exactDecimal}${fraction.slice(2)}`);
            await repository.createAll(prices.map(price => ({ temperature: 1, readings: 1, sequence: 1n, price: new BigNumber(price) })));

            const walked: string[] = [];
            let cursor: string | undefined;
            do {
                const page: KeysetPage<Measurement> = await repository.findAllAfter(cursor, 1, { order: { price: 'DESC' } });
                walked.push(...page.items.map(m => m.price.toFixed()));
                cursor = page.nextCursor;
            }
            while (cursor != undefined);

            expect(walked).toEqual(prices);
        }, 30000);
    });
}