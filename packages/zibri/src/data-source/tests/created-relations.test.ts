import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Book, describeCreatedRelations, Plaque, Shelf } from './created-relations.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Shelf, Book, Plaque] });

let server: StartedTestServer | undefined;
let shelves: Repository<Shelf>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    shelves = inject(dataSourceClass).getRepository(Shelf);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeCreatedRelations('the in memory data source', () => shelves);