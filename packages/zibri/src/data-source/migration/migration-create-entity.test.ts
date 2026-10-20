import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { POSTGRES_TEST_IMAGE } from 'zibri-testing';

import { MigrationEntity } from './migration-entity.model.ts';
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
import { type Relation } from '../../entity/models/relation.type.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { DataSource } from '../decorators/data-source.decorator.ts';
import { SchemaManagement } from '../models/schema-management.model.ts';
import { Transaction } from '../transaction/transaction.model.ts';

@Entity({ tenant: 'shared', tableName: 'workshop' })
class Workshop extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Tool, inverseSide: 'workshop' })
    tools!: Tool[];
}

@Entity({ tenant: 'shared', tableName: 'tool' })
class Tool extends BaseEntity {
    @Property.string({ unique: true })
    serial!: string;

    @Property.string({ format: 'uuid' })
    workshopId!: string;

    @Property.manyToOne({ target: () => Workshop, joinColumn: 'workshopId', inverseSide: 'tools' })
    workshop!: Relation<Workshop>;
}

@Entity({ tenant: 'shared', tableName: 'ledger', uniques: [{ properties: ['year', 'owner'] }] })
class Ledger extends BaseEntity {
    @Property.number({ format: 'integer' })
    year!: number;

    @Property.string()
    owner!: string;

    @Property.string({ required: false })
    note?: string | null;
}

@Injectable()
class CreateEverythingMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        // the migration table is the one the data source creates itself, before any migration runs
        for (const entity of defaultTestServerEntities.filter(e => e !== MigrationEntity)) {
            await this.dataSource.createEntity({ entity, properties: 'resolveFromEntity', transaction });
        }
        // the tool before the workshop it points at, which is the order a foreign key cannot be
        // created in on the spot
        await this.dataSource.createEntity({ entity: Tool, properties: 'resolveFromEntity', transaction });
        await this.dataSource.createEntity({ entity: Workshop, properties: 'resolveFromEntity', transaction });
        // written out, the way a migration describes an entity as it was in the release introducing it
        await this.dataSource.createEntity({
            entity: Ledger,
            properties: {
                year: { type: 'number', format: 'integer' },
                owner: { type: 'string' },
                note: { type: 'string', required: false }
            },
            transaction
        });
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not implemented yet.');
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
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Workshop, Tool, Ledger];
    override migrations: Newable<Migration>[] = [CreateEverythingMigration];
    schemaManagement: SchemaManagement = 'migrations';
}

describe('createEntity', () => {
    let container: StartedPostgreSqlContainer;

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
    }, 30_000);

    // with the indexes and uniques the entities declare, which booting creates once the migrations ran
    it('creates every table as synchronizing would, in whatever order a migration creates them', async () => {
        const dataSource: DbDataSource = inject(DbDataSource);
        dataSource.options = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();

        // what synchronizing would still change is the difference between the two, so nothing left
        // is the schema synchronizing would have created
        const transaction: Transaction = await dataSource.startTransaction();
        const pending: string[] = (await TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.connection.driver
            .createSchemaBuilder()
            .log()).upQueries.map(q => q.query);
        await transaction.rollback();
        expect(pending).toStrictEqual([]);

        // and it is usable: the foreign key the tool could not have been created with holds
        const workshop: Workshop = await dataSource.getRepository(Workshop).create({ name: 'north' });
        await dataSource.getRepository(Tool).create({ serial: 'a1', workshopId: workshop.id });
        await expect(dataSource.getRepository(Tool).create({ serial: 'a2', workshopId: UUIDUtilities.generate() }))
            .rejects.toThrow();
    }, 60_000);

    afterAll(async () => {
        await container?.stop();
    }, 15_000);
});