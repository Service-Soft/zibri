import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeStoredOneOf, Lead } from './one-of-entities.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

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