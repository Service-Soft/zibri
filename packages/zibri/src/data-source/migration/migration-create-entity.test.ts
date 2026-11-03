import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { StartedTestContainer } from 'testcontainers';
import { createPostgresTestContainer } from 'zibri-testing';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { queryPostgres } from '../../__testing__/query-postgres.function';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { GlobalRegistry } from '../../global/global-registry';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres/postgres-data-source.model';
import { PostgresPooler } from '../data-sources/postgres/postgres-pooler.model';
import { PostgresSchemaManager, SynchronizeStep } from '../data-sources/postgres/postgres-schema-manager.model';
import { PostgresSchema } from '../data-sources/postgres/postgres-schema.model';
import { DataSource } from '../decorators/data-source.decorator';
import { SchemaManagement } from '../models/schema-management.model';
import { RepositoryClass } from '../repository/repository-class.type';
import { Transaction } from '../transaction/transaction.model';

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
    workshop!: Workshop;
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
    override options: PostgresOptions = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: false
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Workshop, Tool, Ledger];
    readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    override migrations: Newable<Migration>[] = [CreateEverythingMigration];
    schemaManagement: SchemaManagement = 'migrations';
    readonly pooler: PostgresPooler = 'none';

    /**
     * Resolves what synchronizing the database with the entities would still run.
     * @returns The statements, none when the database is what synchronizing would have created.
     */
    async resolvePendingSynchronizeSteps(): Promise<string[]> {
        const entities: Newable<BaseEntity>[] = [...new Set(this.entities)];
        const manager: PostgresSchemaManager = new PostgresSchemaManager(
            new PostgresSchema(entities, this.columnSettings),
            this.columnSettings,
            entities,
            { threshold: undefined, thresholdIsInclusive: false },
            this.logger
        );
        const steps: SynchronizeStep[] = await manager.resolveSynchronizeSteps(async (sql, values = []) => await queryPostgres(this, sql, values));
        return steps.map(step => step.sql);
    }
}

describe('createEntity', () => {
    let container: StartedTestContainer;

    beforeAll(async () => {
        initDiContainer();
        container = await createPostgresTestContainer({ username: 'postgres', password: 'password', database: 'db' }).start();

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
        expect(await dataSource.resolvePendingSynchronizeSteps()).toStrictEqual([]);

        // and it is usable: the foreign key the tool could not have been created with holds
        const workshop: Workshop = await dataSource.getRepository(Workshop).create({ name: 'north' });
        await dataSource.getRepository(Tool).create({ serial: 'a1', workshopId: workshop.id });
        await expect(dataSource.getRepository(Tool).create({ serial: 'a2', workshopId: UUIDUtilities.generate() }))
            .rejects.toThrow();
    }, 60_000);

    afterAll(async () => {
        // before the container stops, which would end connections nothing closed
        await inject(DbDataSource).shutDown();
        await container?.stop();
    }, 15_000);
});