import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Table } from 'typeorm';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { BigNumber } from '../../utilities/number.utilities';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

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
 * Stored in both data sources, so that what the two answer can be compared rather than assumed.
 */
@Entity({ allowOrphan: true, allowDuplicate: true })
class Measurement extends BaseEntity {
    @Property.number()
    temperature!: number;

    @Property.number({ format: 'integer' })
    readings!: number;

    @Property.number({ format: 'bigint' })
    sequence!: bigint;

    @Property.number({ format: 'bignumber' })
    price!: BigNumber;
}

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Measurement]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Measurement]
});

describe('what a number property is stored as', () => {
    let server: StartedTestServer;
    let postgres: Repository<Measurement>;
    let valKey: Repository<Measurement>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
        postgres = inject(postgresDataSourceClass).getRepository(Measurement);
        valKey = inject(valKeyDataSourceClass).getRepository(Measurement);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 30000);

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('hands each kind back as the type its property declares, on %s', async (_name, repositoryOf) => {
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

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('compares an exact decimal by its value rather than as an object, on %s', async (_name, repositoryOf) => {
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

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('takes a bound on an exact decimal written as any number that fits in one, on %s', async (_name, repositoryOf) => {
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

    it.each([
        ['postgres', () => postgres],
        ['valkey', () => valKey]
    ])('compares a bigint against the whole numbers it holds, on %s', async (_name, repositoryOf) => {
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

    it('declares the column each kind needs', async () => {
        const dataSource: PostgresDataSource = inject(postgresDataSourceClass);
        const table: Table | undefined = await dataSource.createQueryRunner().getTable('measurement');

        // what the format buys beyond the type: a counter in an int4 rather than in an arbitrary
        // precision numeric, which indexes and aggregates as the whole number it is
        expect(table?.findColumnByName('temperature')?.type).toBe('double precision');
        expect(table?.findColumnByName('readings')?.type).toBe('integer');
        expect(table?.findColumnByName('sequence')?.type).toBe('bigint');
        expect(table?.findColumnByName('price')?.type).toBe('numeric');
    }, 30000);
});