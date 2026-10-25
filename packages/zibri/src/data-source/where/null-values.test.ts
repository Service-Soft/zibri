import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeNullValues, Tag } from './null-values.cases';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Tag], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let tags: Repository<Tag>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    tags = inject(dataSourceClass).getRepository(Tag);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeNullValues('the in memory data source', () => tags);