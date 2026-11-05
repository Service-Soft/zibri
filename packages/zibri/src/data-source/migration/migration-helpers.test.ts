import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Badge, describeMigrationHelpers, Gadget } from './migration-helpers.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Gadget, Badge], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeMigrationHelpers('the in memory data source', () => {
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    return { dataSource, gadgets: dataSource.getRepository(Gadget), badges: dataSource.getRepository(Badge) };
});