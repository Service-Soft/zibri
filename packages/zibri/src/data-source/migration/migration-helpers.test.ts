import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Badge, describeMigrationHelpers, Gadget } from './migration-helpers.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';

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