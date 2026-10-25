import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { PostgresDataSource } from './postgres-typeorm-data-source.model';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { inject } from '../../../di/inject.function';
import { Newable } from '../../../types/newable.type';
import { Repository } from '../../repository/repository';
import { Booking } from '../../tests/run-in-transaction.cases';
import { TransactionConflictError } from '../../transaction/transaction-conflict.error';
import { TransactionSerializationError } from '../../transaction/transaction-serialization.error';
import { Transaction } from '../../transaction/transaction.model';
import { IsolationLevel } from '../data-source.interface';

// evaluation/round-2/02-data-layer-stores.md S5: a serializable transaction that lost to another one
// failed with the bare query error, which nothing could tell from any other failed statement

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Booking],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let dataSource: PostgresDataSource;
let bookings: Repository<Booking>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    dataSource = inject(dataSourceClass);
    bookings = dataSource.getRepository(Booking);
}, 50000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describe('two serializable transactions that each book after counting the bookings', () => {
    beforeEach(async () => {
        await bookings.deleteAll({});
    }, 30000);

    it('ends the one committing second with a conflict to run again', async () => {
        const first: Transaction = await dataSource.startTransaction({ isolationLevel: IsolationLevel.SERIALIZABLE });
        const second: Transaction = await dataSource.startTransaction({ isolationLevel: IsolationLevel.SERIALIZABLE });
        await bookings.count({ transaction: first });
        await bookings.count({ transaction: second });
        await bookings.create({ guest: 'first' }, { transaction: first });
        await bookings.create({ guest: 'second' }, { transaction: second });
        await first.commit();

        const failed: Promise<void> = Promise.resolve(second.commit());

        await expect(failed).rejects.toThrow(TransactionSerializationError);
        await expect(failed).rejects.toThrow(TransactionConflictError);
        expect((await bookings.findAll()).map(b => b.guest)).toEqual(['first']);
    }, 30000);

    it('books once, running the work again that lost', async () => {
        let attempts: number = 0;

        await dataSource.runInTransaction(async transaction => {
            attempts++;
            await bookings.count({ transaction });
            if (attempts === 1) {
                // another unit of work counts and books in between, and commits first
                const other: Transaction = await dataSource.startTransaction({ isolationLevel: IsolationLevel.SERIALIZABLE });
                await bookings.count({ transaction: other });
                await bookings.create({ guest: 'other' }, { transaction: other });
                await other.commit();
            }
            await bookings.create({ guest: `attempt ${attempts}` }, { transaction });
        }, { isolationLevel: IsolationLevel.SERIALIZABLE, maxAttempts: 3 });

        expect(attempts).toBe(2);
        expect((await bookings.findAll()).map(b => b.guest).sort()).toEqual(['attempt 2', 'other']);
    }, 30000);
});