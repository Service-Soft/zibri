import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeScopedUpsert, Pass } from './scoped-upsert.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Pass] });

let server: StartedTestServer | undefined;
let passes: Repository<Pass>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    passes = inject(dataSourceClass).getRepository(Pass);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeScopedUpsert('the in memory data source', () => passes);