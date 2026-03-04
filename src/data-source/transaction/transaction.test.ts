import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { StartedTestContainer } from 'testcontainers';

import { POSTGRES_TEST_IMAGE } from '../../__testing__/constants';
import { BaseEntity } from '../../entity/base-entity.model';
import { Repository } from '../repository';
import { Transaction } from './transaction.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource, PostgresOptions } from '../data-sources/postgres-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';

@Entity()
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

@DataSource()
class DbDataSource extends PostgresDataSource {
    options: PostgresOptions = {
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
        container = await new PostgreSqlContainer(POSTGRES_TEST_IMAGE)
            .withDatabase('db')
            .withUsername('postgres')
            .withPassword('password')
            .start();
        dataSource = new DbDataSource();
        dataSource.options = {
            ...dataSource.options,
            port: container.getMappedPort(5432)
        };
        await dataSource.init();
        repo = dataSource.getRepository(Item);
    }, 15000);

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