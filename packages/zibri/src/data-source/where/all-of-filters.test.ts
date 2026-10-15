import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeAllOfFilters, Note } from './all-of-filters.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Note] });

let server: StartedTestServer | undefined;
let notes: Repository<Note>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    notes = inject(dataSourceClass).getRepository(Note);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeAllOfFilters('the in memory data source', () => notes);