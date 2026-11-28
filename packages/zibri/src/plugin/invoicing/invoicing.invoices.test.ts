import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { describeInvoiceList, invoiceListTestEntities, invoiceListTestProviders } from './invoicing.invoices.cases';
import { ZibriInvoicingPlugin } from './invoicing.plugin';

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createInMemoryDataSource({
                entities: [...defaultTestServerEntities, ...invoiceListTestEntities],
                repositories: defaultTestServerRepositories
            })
        ],
        plugins: [new ZibriInvoicingPlugin()],
        providers: [...defaultTestServerProviders, ...invoiceListTestProviders]
    });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeInvoiceList('the in memory data source');
