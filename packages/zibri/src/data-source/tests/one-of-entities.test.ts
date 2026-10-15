import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeStoredOneOf, Lead } from './one-of-entities.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Lead] });

let server: StartedTestServer | undefined;
let leads: Repository<Lead>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    leads = inject(dataSourceClass).getRepository(Lead);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeStoredOneOf('the in memory data source', () => leads);