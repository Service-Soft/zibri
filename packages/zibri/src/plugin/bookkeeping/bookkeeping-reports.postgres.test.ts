import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ZibriApprovalPlugin } from '../approval/approval.plugin';
import { ZibriBankPlugin } from '../bank/bank.plugin';
import { ZibriInvoicingPlugin } from '../invoicing/invoicing.plugin';
import { postingTestEntities, postingTestFileStores, statementsFolder } from './bookkeeping-postings.cases';
import { describeBookkeepingReports, reportTestProviders } from './bookkeeping-reports.cases';
import { receiptsFolder } from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: postingTestFileStores,
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, ...postingTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriInvoicingPlugin(), new ZibriApprovalPlugin(), new ZibriBankPlugin()],
        providers: [...defaultTestServerProviders, ...reportTestProviders]
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
    await FsUtilities.rm(statementsFolder);
}, TestTimeouts.postgres.shutdown);

describeBookkeepingReports('postgres');
