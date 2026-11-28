import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import { describeInvoiceArchive,
    invoiceArchiveTestEntities,
    invoiceArchiveTestProviders,
    InvoiceDocumentsFileStore,
    invoiceDocumentsFolder } from './invoicing.archive.cases';
import { ZibriInvoicingPlugin } from './invoicing.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [InvoiceDocumentsFileStore],
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, ...invoiceArchiveTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [...defaultTestServerProviders, ...invoiceArchiveTestProviders]
    });
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(invoiceDocumentsFolder);
}, TestTimeouts.postgres.shutdown);

describeInvoiceArchive('postgres');