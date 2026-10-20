import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describePagingValues, PagedRow } from './paging-values.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, PagedRow]
});

let server: StartedTestServer | undefined;
let repository: Repository<PagedRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(PagedRow);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describePagingValues('the in memory data source', () => repository);