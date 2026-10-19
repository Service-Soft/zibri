import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeTenantIsolation, TenantIsolationRepositories, TenantNote, TenantNotice, TenantProject, TenantTask } from './tenant-isolation.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, TenantNote, TenantNotice, TenantProject, TenantTask]
});

let server: StartedTestServer | undefined;
let repositories: TenantIsolationRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        dataSource,
        notes: dataSource.getRepository(TenantNote),
        notices: dataSource.getRepository(TenantNotice),
        projects: dataSource.getRepository(TenantProject),
        tasks: dataSource.getRepository(TenantTask)
    };
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeTenantIsolation('the in memory data source', () => repositories);