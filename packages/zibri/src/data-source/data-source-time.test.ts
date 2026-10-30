import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeDataSourceTime, Stamp } from './data-source-time.cases';
import { Repository } from './repository/repository';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';
import { Newable } from '../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Stamp],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let stamps: Repository<Stamp>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    stamps = inject(dataSourceClass).getRepository(Stamp);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeDataSourceTime('the in memory data source', () => stamps);