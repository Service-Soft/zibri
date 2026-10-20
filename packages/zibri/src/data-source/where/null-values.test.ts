import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeNullValues, Tag } from './null-values.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Tag] });

let server: StartedTestServer | undefined;
let tags: Repository<Tag>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    tags = inject(dataSourceClass).getRepository(Tag);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeNullValues('the in memory data source', () => tags);