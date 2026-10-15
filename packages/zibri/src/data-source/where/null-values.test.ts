import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeNullValues, Tag } from './null-values.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

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