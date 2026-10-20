import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { QueryRunner } from 'typeorm';

import { Transaction } from './transaction.model.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities.ts';
import { DataSourceInterface } from '../data-sources/data-source.interface.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../repository/repository.ts';

@Entity({ tenant: 'shared' })
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
    }, 30000);

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

    it('releases the pooled connection when the commit itself throws', async () => {
        // a constraint checked at commit time rather than at insert time is the only way the commit
        // is the statement that fails. Everything else reports itself while the transaction is still
        // open, which leaves the release on the path that already worked
        const setup: Transaction = await dataSource.startTransaction();
        await TypeOrmUtilities.toTypeOrmTransaction(setup).queryRunner.query(
            `CREATE TABLE IF NOT EXISTS deferred_check (
                value int,
                CONSTRAINT deferred_check_unique UNIQUE (value) DEFERRABLE INITIALLY DEFERRED
            )`
        );
        await setup.commit();

        const transaction: Transaction = await dataSource.startTransaction();
        const runner: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
        await runner.query('INSERT INTO deferred_check (value) VALUES (1), (1)');

        await expect(transaction.commit()).rejects.toThrow();

        // the connection goes back to the pool however the commit ended. Releasing only on the way
        // out of a commit that worked loses one for good every time one does not, and a pool is a
        // fixed number of them
        expect(runner.isReleased).toBe(true);
    });

    it('tells the work waiting for its end whether it was committed, once, a failed commit included', async () => {
        const ended: string[] = [];

        const committed: Transaction = await dataSource.startTransaction();
        committed.afterFinish(async hasCommitted => await Promise.resolve(void ended.push(`committed: ${hasCommitted}`)));
        await committed.commit();

        const rolledBack: Transaction = await dataSource.startTransaction();
        rolledBack.afterFinish(async hasCommitted => await Promise.resolve(void ended.push(`rolled back: ${hasCommitted}`)));
        await rolledBack.rollback();

        // the same deferred constraint as above, which the case before creates
        const failing: Transaction = await dataSource.startTransaction();
        failing.afterFinish(async hasCommitted => await Promise.resolve(void ended.push(`failed: ${hasCommitted}`)));
        await TypeOrmUtilities.toTypeOrmTransaction(failing).queryRunner.query('INSERT INTO deferred_check (value) VALUES (2), (2)');
        await expect(failing.commit()).rejects.toThrow();
        // what a caller does on a commit that threw, which finds the transaction ended already
        await Promise.resolve(failing.rollback()).catch(() => undefined);

        expect(ended).toEqual(['committed: true', 'rolled back: false', 'failed: false']);
    });

    afterAll(async () => {
        await server.shutdown();
    }, 15000);
});