import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { describeStoredOneOf, Lead } from './one-of-entities.cases';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [Lead] });

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