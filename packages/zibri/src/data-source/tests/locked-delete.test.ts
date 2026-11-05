import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeLockedDelete, LockedArchive, LockedCompany, lockedDeleteEntities, LockedDeleteRepositories, LockedNotice, LockedOffice } from './locked-delete.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ...lockedDeleteEntities],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repositories: LockedDeleteRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    const dataSource: InMemoryDataSource = inject(dataSourceClass);
    repositories = {
        companies: dataSource.getRepository(LockedCompany),
        offices: dataSource.getRepository(LockedOffice),
        archives: dataSource.getRepository(LockedArchive),
        notices: dataSource.getRepository(LockedNotice)
    };
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeLockedDelete('the in memory data source', () => repositories);