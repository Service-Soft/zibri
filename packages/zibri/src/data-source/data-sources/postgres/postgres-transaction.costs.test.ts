import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { RoundTripCounter } from 'zibri-testing';

import { PostgresDataSource } from './postgres-data-source.model';
import { TestServerTimeouts, TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { AlsUtilities } from '../../../context/als.utilities';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Newable } from '../../../types/newable.type';
import { Repository } from '../../repository/repository';
import { Transaction } from '../../transaction/transaction.model';
import { IsolationLevel } from '../data-source.interface';

const timeouts: TestServerTimeouts = TestTimeouts.postgres;

@Entity({ tenant: 'shared' })
class TransactedItem extends BaseEntity {
    @Property.string()
    value!: string;
}

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TransactedItem],
    repositories: defaultTestServerRepositories,
    roundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, timeouts.start);

afterAll(async () => {
    await server?.shutdown();
}, timeouts.shutdown);

// part of evaluation round 2, 02 §S19: typeorm began a transaction with START TRANSACTION and SET
// TRANSACTION ISOLATION LEVEL, and the data source and the deadline added a statement each, so every
// transaction paid three to four round trips before its first real statement
describe('a postgres transaction', () => {
    it('begins with its isolation level, its idle limit and the deadline it runs under in one round trip', async () => {
        const items: Repository<TransactedItem> = inject(repositoryTokenFor(TransactedItem));
        roundTrips.reset();

        await AlsUtilities.runWithOperationLimit({ timeoutInMs: 5000, signal: undefined }, async () => {
            const transaction: Transaction = await inject(dataSourceClass).startTransaction({ isolationLevel: IsolationLevel.REPEATABLE_READ });
            try {
                await items.findAll({ transaction });
            }
            finally {
                await transaction.rollback();
            }
        });

        const [begin, read, ...rest] = roundTrips.trips.map(trip => trip.statement);
        expect(begin).toMatch(/^BEGIN ISOLATION LEVEL REPEATABLE READ; SET LOCAL idle_in_transaction_session_timeout = \d+; SET LOCAL statement_timeout = 5000$/);
        expect(read).toMatch(/^SELECT /);
        expect(rest).toStrictEqual(['ROLLBACK']);
    }, timeouts.restart);
});