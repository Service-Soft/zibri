import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeSoftDeleteUnique, LiveAccount, LiveMember, softDeleteUniqueEntities, SoftDeleteUniqueRepositories } from './soft-delete-unique.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...softDeleteUniqueEntities],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repositories: SoftDeleteUniqueRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        accounts: dataSource.getRepository(LiveAccount),
        members: dataSource.getRepository(LiveMember)
    };
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeSoftDeleteUnique('the in memory data source', () => repositories);