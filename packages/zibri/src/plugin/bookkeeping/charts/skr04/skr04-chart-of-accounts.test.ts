import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../../../utilities/fs.utilities';
import { bookkeepingTestEntities, bookkeepingTestOptions, ReceiptsFileStore, receiptsFolder } from '../../bookkeeping.cases';
import { ZibriBookkeepingPlugin } from '../../bookkeeping.plugin';
import { BookkeepingAccountType } from '../../models/bookkeeping-account-type.enum';
import { describeChartOfAccounts, describeChartOfAccountsYear } from '../chart-of-accounts.cases';
import { skr04ChartOfAccounts } from './skr04-chart-of-accounts.model';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin()],
        providers: [...defaultTestServerProviders, bookkeepingTestOptions]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.inMemory.shutdown);

// SKR 04 is ordered by the statements: each class holds the accounts of one part of them, beside the few accounts the
// frame puts next to the accounts they offset
describeChartOfAccounts(skr04ChartOfAccounts, [
    // the contributions not called in yet, deducted from the capital
    { from: '0000', until: '0089', types: [BookkeepingAccountType.EQUITY] },
    { from: '0090', until: '0999', types: [BookkeepingAccountType.ASSET] },
    { from: '1000', until: '1999', types: [BookkeepingAccountType.ASSET] },
    // the clearing of payments received over the debtors, and the bank liabilities outside the cash funds
    { from: '1495', until: '1495', types: [BookkeepingAccountType.LIABILITY] },
    { from: '1895', until: '1895', types: [BookkeepingAccountType.LIABILITY] },
    { from: '2000', until: '2999', types: [BookkeepingAccountType.EQUITY] },
    { from: '3000', until: '3999', types: [BookkeepingAccountType.LIABILITY] },
    // the clearing of payments made over the creditors
    { from: '3695', until: '3695', types: [BookkeepingAccountType.ASSET] },
    { from: '4000', until: '4999', types: [BookkeepingAccountType.REVENUE] },
    { from: '5000', until: '6999', types: [BookkeepingAccountType.EXPENSE] },
    { from: '7000', until: '7699', types: [BookkeepingAccountType.REVENUE, BookkeepingAccountType.EXPENSE] },
    // the appropriation of the result, which changes the equity and not the result
    { from: '7700', until: '7799', types: [BookkeepingAccountType.EQUITY] },
    { from: '9000', until: '9099', types: [BookkeepingAccountType.EQUITY] },
    { from: '9100', until: '9999', types: [BookkeepingAccountType.EXPENSE] }
]);

describeChartOfAccountsYear(skr04ChartOfAccounts, {
    bank: '1800',
    capital: '2900',
    receivables: '1200',
    revenue19: '4400',
    outputTax19: '3806',
    officeSupplies: '6815',
    inputTax19: '1406',
    payables: '3300',
    rent: '6310',
    equipment: '0650',
    vatPrepayment: '3820',
    wages: '6000',
    socialSecurity: '6110',
    payroll: '3790',
    interest: '7310',
    bankFees: '6855',
    depreciation: '6220',
    tradeTax: '7610',
    taxProvision: '3020'
});