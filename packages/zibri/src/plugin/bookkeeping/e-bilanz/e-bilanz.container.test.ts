import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../../utilities/fs.utilities';
import { bookkeepingTestEntities, ReceiptsFileStore, receiptsFolder } from '../bookkeeping.cases';
import { ZibriBookkeepingPlugin } from '../bookkeeping.plugin';
import { describeEBilanz, eBilanzTestEntities, eBilanzTestProviders } from './e-bilanz.cases';
import { ZibriEBilanzPlugin } from './e-bilanz.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities, ...eBilanzTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin(), new ZibriEBilanzPlugin()],
        providers: [...defaultTestServerProviders, ...eBilanzTestProviders]
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.postgres.shutdown);

describeEBilanz('Postgres');