import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Account, describeScopedRelations, Invoice, Project, ScopedRelationRepositories, scopedRelationEntities, Tag, Task } from './scoped-relations.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...scopedRelationEntities],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repositories: ScopedRelationRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        accounts: dataSource.getRepository(Account),
        invoices: dataSource.getRepository(Invoice),
        tags: dataSource.getRepository(Tag),
        projects: dataSource.getRepository(Project),
        tasks: dataSource.getRepository(Task)
    };
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeScopedRelations('the in memory data source', () => repositories);