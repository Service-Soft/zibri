import { randomBytes } from 'node:crypto';

import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Table, TableColumn } from 'typeorm';
import { POSTGRES_TEST_IMAGE } from 'zibri-testing';

import { Migration } from './migration.model.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { inject } from '../../di/inject.function.ts';
import { register } from '../../di/register.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../decorators/data-source.decorator.ts';
import { SchemaManagement } from '../models/schema-management.model.ts';
import { Repository } from '../repository/repository.ts';
import { Transaction } from '../transaction/transaction.model.ts';

@Entity({ tenant: 'shared', tableName: 'measurement' })
class LegacyMeasurement {
    @Property.string({ primary: true })
    id!: string;

    @Property.number({ format: 'integer' })
    amount!: number;

    @Property.string()
    label!: string;
}

@DataSource()
class LegacyDbDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, LegacyMeasurement];
    // stands in for the database as it was before the migration, so it is created from the classes
    schemaManagement: SchemaManagement = 'synchronize';
}

@Entity({ tenant: 'shared', tableName: 'measurement' })
class Measurement {
    @Property.string({ primary: true })
    id!: string;

    @Property.number()
    amount!: number;

    @Property.string()
    title!: string;
}

@Injectable()
class WidenAmountMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity({
            entity: Measurement,
            currentProperty: { name: 'amount', type: 'number', format: 'integer' },
            property: { name: 'amount', type: 'number', format: 'number' },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: Measurement,
            currentProperty: { name: 'label', type: 'string' },
            property: { type: 'string', name: 'title' },
            transaction
        });
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity({
            entity: Measurement,
            currentProperty: { name: 'title', type: 'string' },
            property: { name: 'label', type: 'string' },
            transaction
        });
        await this.dataSource.changePropertyOfEntity({
            entity: Measurement,
            currentProperty: { name: 'amount', type: 'number', format: 'number' },
            property: { name: 'amount', type: 'number', format: 'integer' },
            transaction
        });
    }
}

@DataSource()
class DbDataSource extends PostgresDataSource {
    override options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Measurement];
    override migrations: Newable<Migration>[] = [WidenAmountMigration];
    // the framework entities still need their tables. Synchronizing after the migration also makes
    // this a test of the migration alone: had it left the column as it was, synchronize would
    // recreate it, and the value would be gone just the same
    schemaManagement: SchemaManagement = 'synchronize';
}

describe('changePropertyOfEntity', () => {
    let container: StartedPostgreSqlContainer;
    let createdId: string;

    beforeAll(async () => {
        initDiContainer();
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();

        GlobalRegistry['appData'].version = '0.0.1';
        register({
            token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
            useValue: {
                currentMasterStrategy: new AesGcmEncryptionStrategy(),
                currentMasterKey: { id: 'mk1', value: randomBytes(32) }
            }
        });

        const legacyDataSource: LegacyDbDataSource = inject(LegacyDbDataSource);
        legacyDataSource.options = {
            ...legacyDataSource.options,
            port: container.getMappedPort(5432)
        };
        await legacyDataSource.init();

        const legacyRepository: Repository<LegacyMeasurement> = legacyDataSource.getRepository(LegacyMeasurement);
        createdId = (await legacyRepository.create({ amount: 42, label: 'first' })).id;
        await legacyDataSource.shutDown();
    }, 50000);

    it('changes the type of a column without losing what it holds', async () => {
        const dataSource: DbDataSource = inject(DbDataSource);
        dataSource.options = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();

        const table: Table | undefined = await dataSource.createQueryRunner().getTable('measurement');
        const amount: TableColumn | undefined = table?.findColumnByName('amount');
        const title: TableColumn | undefined = table?.findColumnByName('title');
        expect(amount?.type).toBe('double precision');
        expect(title).not.toBeUndefined();
        expect(table?.findColumnByName('label')).toBeUndefined();

        // typeorm answers a changed type by dropping the column and adding it again, which a migration
        // written to *change* a property never asked for - the values went with the old column, and
        // a required one could not even be added back to a table that had rows. A rename is the case
        // typeorm already did in place, and it has to stay that way
        const measurement: Measurement = await dataSource.getRepository(Measurement).findById(createdId);
        expect(measurement.amount).toBe(42);
        expect(measurement.title).toBe('first');
    }, 30_000);

    afterAll(async () => {
        await container?.stop();
    }, 15_000);
});