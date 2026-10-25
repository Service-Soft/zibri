import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeStoredOneOf, Lead } from './one-of-entities.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Lead], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let leads: Repository<Lead>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    leads = inject(dataSourceClass).getRepository(Lead);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeStoredOneOf('the in memory data source', () => leads);