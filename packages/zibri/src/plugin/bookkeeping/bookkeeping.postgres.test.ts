import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import {
    bookkeepingTestConformances,
    bookkeepingTestEntities,
    bookkeepingTestOptions,
    describeBookkeeping,
    ReceiptsFileStore,
    receiptsFolder
} from './bookkeeping.cases';
import { ZibriBookkeepingPlugin } from './bookkeeping.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [ReceiptsFileStore],
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, ...bookkeepingTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriBookkeepingPlugin()],
        providers: [...defaultTestServerProviders, bookkeepingTestOptions, bookkeepingTestConformances]
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(receiptsFolder);
}, TestTimeouts.postgres.shutdown);

describeBookkeeping('postgres');
