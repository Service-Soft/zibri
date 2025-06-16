import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';
import { PostgresConnectionCredentialsOptions } from 'typeorm/driver/postgres/PostgresConnectionCredentialsOptions';

import { BaseEntity, Entity, Property } from '../../entity';
import { Newable } from '../../types';
import { BaseDataSource } from '../base-data-source.model';
import { DataSource } from '../decorators';
import { Repository } from '../repository.model';
import { Transaction } from './transaction.model';
import { MigrationEntity } from '../migration';
import { DataSourceOptions } from '../models';

@Entity()
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
}

let container: StartedTestContainer;
let dataSource: DbDataSource;
let repo: Repository<Item>;

describe('transaction', () => {
    beforeAll(async () => {
        container = await new PostgreSqlContainer()
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        dataSource = new DbDataSource();
        (dataSource.options as PostgresConnectionCredentialsOptions) = {
            ...dataSource.options as PostgresConnectionCredentialsOptions,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();
        repo = dataSource.getRepository(Item);
    }, 10000);

    it('should see changes inside transaction, but not outside until committed', async () => {
        const transaction: Transaction = await dataSource.startTransaction();

        await repo.create({ value: '42' }, { transaction });
        const items: Item[] = await repo.findAll({ transaction });
        expect(items.length).toEqual(1);

        const itemsWithoutTransaction: Item[] = await repo.findAll();
        expect(itemsWithoutTransaction.length).toEqual(0);

        await transaction.commit();

        const itemsWithoutTransactionAfterCommit: Item[] = await repo.findAll();
        expect(itemsWithoutTransactionAfterCommit.length).toEqual(1);
    });

    afterAll(async () => {
        await container?.stop();
    });
});