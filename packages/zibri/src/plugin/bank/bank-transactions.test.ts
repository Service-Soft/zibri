import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { bankTransactionsStatementsFolder,
    BankTransactionsStatementFileStore,
    bankTransactionsTestEntities,
    bankTransactionsTestProviders,
    describeBankTransactions } from './bank-transactions.cases';
import { ZibriBankPlugin } from './bank.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [BankTransactionsStatementFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...bankTransactionsTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBankPlugin(), new ZibriApprovalPlugin(), new ZibriInvoicingPlugin()],
        providers: [...defaultTestServerProviders, ...bankTransactionsTestProviders]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(bankTransactionsStatementsFolder);
}, TestTimeouts.inMemory.shutdown);

describeBankTransactions('the in memory data source');