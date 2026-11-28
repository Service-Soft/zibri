import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { FsUtilities } from '../../utilities/fs.utilities';
import {
    describeInvoiceArchive,
    invoiceArchiveTestEntities,
    invoiceArchiveTestProviders,
    InvoiceDocumentsFileStore,
    invoiceDocumentsFolder
} from './invoicing.archive.cases';
import { ZibriInvoicingPlugin } from './invoicing.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        fileStores: [InvoiceDocumentsFileStore],
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...invoiceArchiveTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [...defaultTestServerProviders, ...invoiceArchiveTestProviders]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
    await FsUtilities.rm(invoiceDocumentsFolder);
}, TestTimeouts.inMemory.shutdown);

describeInvoiceArchive('the in memory data source');
