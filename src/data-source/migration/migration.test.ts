import { randomBytes } from 'node:crypto';

import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Table, TableColumn } from 'typeorm';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { POSTGRES_TEST_IMAGE } from '../../__testing__/constants';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
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
import { OmitStrict } from '../../types/omit-strict.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres-typeorm-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { Repository } from '../repository';
import { Transaction } from '../transaction/transaction.model';

@Entity({ tableName: 'item' })
class LegacyItem {
    @Property.string({ primary: true })
    id!: string;
}

@DataSource()
class LegacyDbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, LegacyItem];
}

@Entity({ tableName: 'item' })
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@DataSource()
class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type'> = {
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Item];
    migrations: Newable<Migration>[] = [AddTestValueMigration];
}

@Injectable()
class AddTestValueMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor(
        @InjectRepository(Item)
        private readonly itemRepository: Repository<Item>
    ) {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.dataSource.addPropertyToEntity(Item, 'value', transaction);
        const existingItems: Item[] = await this.itemRepository.findAll({ transaction });
        await Promise.all(existingItems.map(t => this.itemRepository.updateById(t.id, { value: '42' }, { transaction })));
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not implemented yet.');
    }
}

describe('AddTestValueMigration', () => {
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

        // seed one row without `value`
        const legacyItemRepository: Repository<LegacyItem> = legacyDataSource.getRepository(LegacyItem);
        createdId = (await legacyItemRepository.create({})).id;
    }, 15000);

    it('should add non-nullable value column with backfilled defaults', async () => {
        const dataSource: DbDataSource = inject(DbDataSource);

        dataSource.options = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();

        // inspect column metadata
        const table: Table | undefined = await dataSource.createQueryRunner().getTable('item');
        expect(table).not.toBeUndefined();
        const col: TableColumn | undefined = table?.findColumnByName('value');
        expect(col).not.toBeUndefined();
        expect(col?.isNullable).toBe(false);

        // old item must have non-null value
        const itemRepository: Repository<Item> = dataSource.getRepository(Item);
        const item: Item = await itemRepository.findById(createdId);
        expect(item.value).toEqual('42');

        const migrationEntityRepository: Repository<MigrationEntity> = dataSource.getRepository(MigrationEntity);
        const res: MigrationEntity = await migrationEntityRepository.findOne({ where: { version: '0.0.1' } });
        expect(res).not.toBeNull();
    });
    afterAll(async () => {
        await container.stop();
    });
});