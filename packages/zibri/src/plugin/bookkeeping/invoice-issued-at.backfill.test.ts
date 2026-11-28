import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ZibriBankPlugin } from '../bank/bank.plugin';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { exportTestEntities, exportTestProviders } from './bookkeeping-export.cases';
import { postingTestFileStores, statementsFolder } from './bookkeeping-postings.cases';
import { receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';
import { describeIssuedAtBackfill } from './invoice-issued-at.backfill.cases';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: postingTestFileStores,
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...exportTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriInvoicingPlugin(), new ZibriApprovalPlugin(), new ZibriBankPlugin()],
        providers: [...defaultTestServerProviders, ...exportTestProviders]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.inMemory.shutdown);

describeIssuedAtBackfill('the in memory data source');
