import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Repository } from '../repository';
import { Transaction } from './transaction.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres-typeorm-data-source.model';

@Entity()
class Item {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

let server: StartedTestServer;
let dataSource: DataSourceInterface;
let repo: Repository<Item>;

describe('transaction', () => {
    beforeAll(async () => {
        const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({ entities: [...defaultTestServerEntities, Item] });
        server = await startTestServer({ dataSources: [dataSourceClass] });
        dataSource = inject(dataSourceClass);
        repo = inject(repositoryTokenFor(Item));
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

    it('should discard changes made inside a rolled back transaction', async () => {
        const before: Item[] = await repo.findAll();

        const transaction: Transaction = await dataSource.startTransaction();

        await repo.create({ value: 'rolled-back' }, { transaction });
        const itemsInsideTransaction: Item[] = await repo.findAll({ transaction });
        expect(itemsInsideTransaction.length).toEqual(before.length + 1);

        await transaction.rollback();

        const itemsAfterRollback: Item[] = await repo.findAll();
        expect(itemsAfterRollback.length).toEqual(before.length);
        expect(itemsAfterRollback.some(i => i.value === 'rolled-back')).toBe(false);
    });

    it('releases the query runner after commit, rejecting further queries against it', async () => {
        const transaction: Transaction = await dataSource.startTransaction();
        await transaction.commit();

        await expect(repo.create({ value: 'after-release' }, { transaction })).rejects.toThrow();
    });

    it('releases the query runner after rollback, rejecting further queries against it', async () => {
        const transaction: Transaction = await dataSource.startTransaction();
        await transaction.rollback();

        await expect(repo.create({ value: 'after-release' }, { transaction })).rejects.toThrow();
    });

    afterAll(async () => {
        await server.shutdown();
    }, 15000);
});