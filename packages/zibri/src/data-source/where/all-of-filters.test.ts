import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeAllOfFilters, Note } from './all-of-filters.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

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