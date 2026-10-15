import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Badge, describeMigrationHelpers, Gadget } from './migration-helpers.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Gadget, Badge] });

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeMigrationHelpers('the in memory data source', () => {
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});