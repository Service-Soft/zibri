import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, zibriFrameworkEntities } from 'zibri-testing';

import { TransactionAlreadyFinishedError } from './transaction-already-finished.error';
import { Transaction } from './transaction.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { RepositoryClass } from '../repository/repository-class.type';

// evaluation/round-2/12-hardcoded-values.md §D4: every transaction got ten seconds unless the call
// starting it said otherwise, with no default of the data source's own

/**
 * A data source whose transactions are given up on after a fifth of a second.
 */
@DataSource()
class ImpatientDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...defaultTestServerEntities])];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    protected override readonly transactionIdleTimeoutInMs: number = 200;
}

describe('the idle timeout of a data source', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [ImpatientDataSource] });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('rolls back a transaction that sat idle longer than the data source allows', async () => {
        const transaction: Transaction = await inject(ImpatientDataSource).startTransaction();

        await new Promise(resolve => setTimeout(resolve, 600));

        await expect(transaction.commit()).rejects.toThrow(TransactionAlreadyFinishedError);
    });

    it('lets a transaction that says so when it starts sit idle longer', async () => {
        const transaction: Transaction = await inject(ImpatientDataSource).startTransaction({ idleTimeoutInMs: 5000 });

        await new Promise(resolve => setTimeout(resolve, 600));

        await expect(transaction.commit()).resolves.toBeUndefined();
    });
});
