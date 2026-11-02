import { describe, expect, it, jest } from '@jest/globals';

import { TestServerTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Transaction } from '../transaction/transaction.model';

/**
 * The application a case boots, and the data source in it whose transaction is left open.
 */
export type TransactionOpenAtShutdownSetup = {
    /**
     * Every data source of the application.
     */
    dataSources: Newable<DataSourceInterface>[],
    /**
     * The one the transaction is started on.
     */
    dataSource: Newable<DataSourceInterface>,
    /**
     * How long the application may take to start and to shut down.
     */
    timeouts: TestServerTimeouts
};

/**
 * Cases for a transaction nothing committed or rolled back when its application shuts down. Each
 * boots an application of its own, since it is the shutdown that is tested.
 * @param dataSourceName - The kind of data source, as the cases name it.
 * @param setup - The application to boot.
 */
export function describeTransactionOpenAtShutdown(dataSourceName: string, setup: TransactionOpenAtShutdownSetup): void {
    describe(`a transaction still open when the application shuts down, on ${dataSourceName}`, () => {
        // found with the container run of foreign-transaction.postgres-valkey.test.ts: on postgres the
        // shutdown waited for the connection until the server ended the transaction, and in memory
        // and on valkey its idle timer fired after the application was gone, where logging throws
        it('is rolled back as its data source shuts down, and reported', async () => {
            const server: StartedTestServer = await startTestServer({ dataSources: setup.dataSources });
            const transaction: Transaction = await inject(setup.dataSource).startTransaction();
            const logged: jest.Spied<LoggerInterface['error']> = jest.spyOn(inject(ZIBRI_DI_TOKENS.LOGGER), 'error');

            await server.shutdown();

            expect(transaction.isFinished).toBe(true);
            expect(logged).toHaveBeenCalledWith(expect.objectContaining({
                message: expect.stringMatching(/1 transaction .* still open .* rolled back/)
            }));
        }, setup.timeouts.start + setup.timeouts.shutdown);
    });
}