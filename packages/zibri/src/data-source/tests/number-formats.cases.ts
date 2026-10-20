import { describe, expect, it } from 'vitest';

import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';
import { Repository } from '../repository/repository.ts';

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
     * An exact decimal.
     */
    @Property.number({ format: 'bignumber' })
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
}