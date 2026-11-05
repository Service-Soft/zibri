import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describePagedReads, PagedCustomer, PagedLine, PagedOrder, pagedReadEntities, PagedReadRepositories } from './paged-reads.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...pagedReadEntities],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repositories: PagedReadRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repositories = {
        customers: inject(dataSourceClass).getRepository(PagedCustomer),
        orders: inject(dataSourceClass).getRepository(PagedOrder),
        lines: inject(dataSourceClass).getRepository(PagedLine)
    };
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describePagedReads('the in memory data source', () => repositories);