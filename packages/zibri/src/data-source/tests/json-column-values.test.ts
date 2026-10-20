import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Table } from 'typeorm';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { BigNumber } from '../../utilities/number.utilities.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

/**
 * A whole number one past what a double can tell apart, so that a value read back through one is a
 * different value rather than the same one.
 */
const pastSafeInteger: bigint = 9007199254740993n;

/**
 * A decimal with more digits than a double holds exactly.
 */
const exactDecimal: string = '12345678901234567890.123456789';

const calibratedAt: Date = new Date('2024-03-01T10:15:30.000Z');

const takenAtLater: Date = new Date('2024-03-02T10:15:30.000Z');

class Sensor {
    @Property.string()
    name!: string;

    @Property.date()
    calibratedAt!: Date;

    @Property.number({ format: 'bigint' })
    serial!: bigint;

    @Property.number({ format: 'bignumber' })
    tolerance!: BigNumber;
}

class Sample {
    @Property.date()
    takenAt!: Date;

    @Property.number({ format: 'bigint' })
    tick!: bigint;
}

/**
 * Stored in both data sources, so that what the two answer can be compared rather than assumed.
 */
@Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true })
class Reading extends BaseEntity {
    @Property.object({ cls: () => Sensor })
    sensor!: Sensor;

    @Property.array({ items: { type: 'object', cls: () => Sample } })
    samples!: Sample[];

    @Property.array({ items: { type: 'number', format: 'bigint' } })
    ticks!: bigint[];

    @Property.array({ items: { type: 'number', format: 'bignumber' } })
    tolerances!: BigNumber[];
}

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Reading]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Reading]
});

/**
 * The values every test writes, so that what comes back can be compared against what went in.
 * @returns The data to create a reading from.
 */
function readingData(): Omit<Reading, keyof BaseEntity> {
    return {
        sensor: {
            name: 'outside',
            calibratedAt: calibratedAt,
            serial: pastSafeInteger,
            tolerance: new BigNumber(exactDecimal)
        },
        samples: [
            { takenAt: calibratedAt, tick: pastSafeInteger },
            { takenAt: takenAtLater, tick: 2n }
        ],
        ticks: [pastSafeInteger, 2n],
        tolerances: [new BigNumber(exactDecimal), new BigNumber('0.5')]
    };
}

describe('what a value inside a json column is read back as', () => {
    let server: StartedTestServer;
    let postgres: Repository<Reading>;
    let valKey: Repository<Reading>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
        postgres = inject(postgresDataSourceClass).getRepository(Reading);
        valKey = inject(valKeyDataSourceClass).getRepository(Reading);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands a nested property back as the type it declares, on %s', async (_name, repositoryOf) => {
        const repository: Repository<Reading> = repositoryOf();
        const created: Reading = await repository.create(readingData());

        const read: Reading = await repository.findById(created.id);

        // json carries strings, numbers, booleans and nothing else, so each of these went in as
        // text - and the property that declares what it is, is what reads it back
        expect(read.sensor.calibratedAt).toBeInstanceOf(Date);
        expect(read.sensor.calibratedAt.getTime()).toBe(calibratedAt.getTime());
        expect(typeof read.sensor.serial).toBe('bigint');
        expect(read.sensor.serial).toBe(pastSafeInteger);
        expect(read.sensor.tolerance).toBeInstanceOf(BigNumber);
        expect(read.sensor.tolerance.toFixed()).toBe(exactDecimal);
        expect(read.sensor.name).toBe('outside');
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands the items of an array of objects back the same way, on %s', async (_name, repositoryOf) => {
        const repository: Repository<Reading> = repositoryOf();
        const created: Reading = await repository.create(readingData());

        const read: Reading = await repository.findById(created.id);

        expect(read.samples).toHaveLength(2);
        expect(read.samples.map(s => s.takenAt instanceof Date)).toEqual([true, true]);
        expect(read.samples.map(s => s.takenAt.getTime())).toEqual([calibratedAt.getTime(), takenAtLater.getTime()]);
        expect(read.samples.map(s => typeof s.tick)).toEqual(['bigint', 'bigint']);
        expect(read.samples.map(s => s.tick)).toEqual([pastSafeInteger, 2n]);
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands an array of numbers back in the format its items declare, on %s', async (_name, repositoryOf) => {
        const repository: Repository<Reading> = repositoryOf();
        const created: Reading = await repository.create(readingData());

        const read: Reading = await repository.findById(created.id);

        expect(read.ticks.map(t => typeof t)).toEqual(['bigint', 'bigint']);
        expect(read.ticks).toEqual([pastSafeInteger, 2n]);
        expect(read.tolerances.every(t => t instanceof BigNumber)).toBe(true);
        expect(read.tolerances.map(t => t.toFixed())).toEqual([exactDecimal, '0.5']);
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands an updated row back as the same types a read does, on %s', async (_name, repositoryOf) => {
        const repository: Repository<Reading> = repositoryOf();
        const created: Reading = await repository.create(readingData());

        const updated: Reading = await repository.updateById(created.id, {
            ticks: [3n, pastSafeInteger]
        });
        const read: Reading = await repository.findById(created.id);

        // an update hands back what is stored rather than reading it again, so the column it did
        // not write has to arrive as the type it declares just the same - and as the same value
        // the read after it gives
        expect(updated.ticks).toEqual([3n, pastSafeInteger]);
        expect(updated.sensor.calibratedAt).toBeInstanceOf(Date);
        expect(updated.sensor.calibratedAt.getTime()).toBe(calibratedAt.getTime());
        expect(typeof updated.sensor.serial).toBe('bigint');
        expect(updated.sensor.tolerance).toBeInstanceOf(BigNumber);
        expect(updated.sensor.tolerance.toFixed()).toBe(exactDecimal);
        expect(updated.samples.map(s => s.takenAt.getTime())).toEqual(read.samples.map(s => s.takenAt.getTime()));
        expect(updated.tolerances.map(t => t.toFixed())).toEqual(read.tolerances.map(t => t.toFixed()));
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands a bulk updated row back the same way, on %s', async (_name, repositoryOf) => {
        const repository: Repository<Reading> = repositoryOf();
        const created: Reading = await repository.create(readingData());

        const [updated]: Reading[] = await repository.updateAll(
            { id: created.id },
            { ticks: [4n] },
            { returnUpdated: true }
        );

        expect(updated?.ticks).toEqual([4n]);
        expect(updated?.sensor.serial).toBe(pastSafeInteger);
        expect(updated?.tolerances.map(t => t.toFixed())).toEqual([exactDecimal, '0.5']);
        expect(updated?.samples.map(s => typeof s.tick)).toEqual(['bigint', 'bigint']);
    }, 30000);

    it('declares the column an array of numbers needs', async () => {
        const dataSource: PostgresDataSource = inject(postgresDataSourceClass);
        const table: Table | undefined = await dataSource.createQueryRunner().getTable('reading');

        // an array of numbers is an array of what one of them is stored as, so the item's format
        // decides the element type the same way it would alone
        expect(table?.findColumnByName('ticks')?.type).toBe('bigint');
        expect(table?.findColumnByName('tolerances')?.type).toBe('numeric');
        expect(table?.findColumnByName('sensor')?.type).toBe('jsonb');
        expect(table?.findColumnByName('samples')?.type).toBe('jsonb');
    }, 30000);
});