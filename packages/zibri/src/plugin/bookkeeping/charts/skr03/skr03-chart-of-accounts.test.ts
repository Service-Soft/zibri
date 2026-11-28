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
import { skr03ChartOfAccounts } from './skr03-chart-of-accounts.model';

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

// SKR 03 is ordered by the flow of the business: a class holds accounts of both statements where that flow puts them
describeChartOfAccounts(skr03ChartOfAccounts, [
    { from: '0000', until: '0999', types: [BookkeepingAccountType.ASSET, BookkeepingAccountType.EQUITY, BookkeepingAccountType.LIABILITY] },
    { from: '1000', until: '1999', types: [BookkeepingAccountType.ASSET, BookkeepingAccountType.LIABILITY] },
    { from: '2000', until: '2999', types: [BookkeepingAccountType.REVENUE, BookkeepingAccountType.EXPENSE] },
    // the appropriation of the result, which changes the equity and not the result
    { from: '2480', until: '2499', types: [BookkeepingAccountType.EQUITY] },
    { from: '2745', until: '2745', types: [BookkeepingAccountType.EQUITY] },
    { from: '2795', until: '2889', types: [BookkeepingAccountType.EQUITY] },
    { from: '3000', until: '3969', types: [BookkeepingAccountType.EXPENSE] },
    { from: '3970', until: '3989', types: [BookkeepingAccountType.ASSET] },
    { from: '3990', until: '3999', types: [BookkeepingAccountType.EXPENSE] },
    { from: '4000', until: '4999', types: [BookkeepingAccountType.EXPENSE] },
    { from: '7000', until: '7999', types: [BookkeepingAccountType.ASSET] },
    { from: '8000', until: '8999', types: [BookkeepingAccountType.REVENUE] },
    // the proceeds from the sale of fixed assets at a loss, reported with the other operating expenses
    { from: '8800', until: '8819', types: [BookkeepingAccountType.EXPENSE] },
    { from: '9000', until: '9099', types: [BookkeepingAccountType.EQUITY] },
    { from: '9100', until: '9999', types: [BookkeepingAccountType.EXPENSE] }
]);

describeChartOfAccountsYear(skr03ChartOfAccounts, {
    bank: '1200',
    capital: '0800',
    receivables: '1400',
    revenue19: '8400',
    outputTax19: '1776',
    officeSupplies: '4930',
    inputTax19: '1576',
    payables: '1600',
    rent: '4210',
    equipment: '0420',
    vatPrepayment: '1780',
    wages: '4100',
    socialSecurity: '4130',
    payroll: '1755',
    interest: '2110',
    bankFees: '4970',
    depreciation: '4830',
    tradeTax: '4320',
    taxProvision: '0955'
});
