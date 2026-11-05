import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Book, describeCreatedRelations, Plaque, Shelf } from './created-relations.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Shelf, Book, Plaque], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let shelves: Repository<Shelf>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    shelves = inject(dataSourceClass).getRepository(Shelf);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeCreatedRelations('the in memory data source', () => shelves);