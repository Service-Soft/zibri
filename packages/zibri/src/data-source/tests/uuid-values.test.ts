import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUuidValues, UuidItem, UuidOwner, UuidValueRepositories } from './uuid-values.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, UuidOwner, UuidItem]
});

let server: StartedTestServer | undefined;
let repositories: UuidValueRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        owners: dataSource.getRepository(UuidOwner),
        items: dataSource.getRepository(UuidItem)
    };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeUuidValues('the in memory data source', () => repositories);