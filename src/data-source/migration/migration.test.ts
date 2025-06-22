import { beforeAll, afterAll, describe, it, expect } from '@jest/globals';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSourceOptions, Table, TableColumn } from 'typeorm';
import { PostgresConnectionCredentialsOptions } from 'typeorm/driver/postgres/PostgresConnectionCredentialsOptions';

import { inject, Injectable, InjectRepository } from '../../di';
import { BaseEntity, Entity, Property } from '../../entity';
import { Newable, Version } from '../../types';
import { BaseDataSource } from '../base-data-source.model';
import { Transaction } from '../transaction';
import { Migration } from './migration.model';
import { DataSource } from '../decorators';
import { Repository } from '../repository.model';
import { MigrationEntity } from './migration-entity.model';
import { GlobalRegistry } from '../../global';

@Entity('item')
class LegacyItem {
    @Property.string({ primary: true })
    id!: string;
}

@DataSource()
class LegacyDbDataSource extends BaseDataSource {
    options: DataSourceOptions = {
        type: 'postgres',
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [MigrationEntity, LegacyItem];
}

@Entity('item')
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@DataSource()
class DbDataSource extends BaseDataSource {
    options: DataSourceOptions = {
        type: 'postgres',
        host: 'localhost',
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };
    entities: Newable<BaseEntity>[] = [MigrationEntity, Item];
    migrations: Newable<Migration>[] = [AddTestValueMigration];
}

@Injectable()
class AddTestValueMigration extends Migration {
    version: Version = '0.0.1';

    constructor(
        @InjectRepository(Item)
        private readonly itemRepository: Repository<Item>
    ) {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.addColumn(Item, 'value', transaction);
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
        container = await new PostgreSqlContainer()
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();

        GlobalRegistry['appData'].version = '0.0.1';

        const legacyDataSource: LegacyDbDataSource = inject(LegacyDbDataSource);
        (legacyDataSource.options as PostgresConnectionCredentialsOptions) = {
            ...legacyDataSource.options as PostgresConnectionCredentialsOptions,
            port: container.getMappedPort(5432)
        };
        await legacyDataSource.init();

        // seed one row without `value`
        const legacyItemRepository: Repository<LegacyItem> = legacyDataSource.getRepository(LegacyItem);
        createdId = (await legacyItemRepository.create({})).id;
    }, 15000);

    it('should add non-nullable value column with backfilled defaults', async () => {
        const dataSource: DbDataSource = inject(DbDataSource);

        (dataSource.options as PostgresConnectionCredentialsOptions) = {
            ...dataSource.options as PostgresConnectionCredentialsOptions,
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