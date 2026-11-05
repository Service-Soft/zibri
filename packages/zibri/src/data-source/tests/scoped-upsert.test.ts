import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeScopedUpsert, Pass } from './scoped-upsert.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Pass], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let passes: Repository<Pass>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    passes = inject(dataSourceClass).getRepository(Pass);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeScopedUpsert('the in memory data source', () => passes);