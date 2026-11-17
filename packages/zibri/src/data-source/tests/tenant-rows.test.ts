import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeTenantRows, describeTenantRowsAsOfOneMoment, TENANT_ROWS_ENTITIES } from './tenant-rows.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...TENANT_ROWS_ENTITIES],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeTenantRows('the in memory data source', () => inject(dataSourceClass));

describeTenantRowsAsOfOneMoment('the in memory data source', () => inject(dataSourceClass));