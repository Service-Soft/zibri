import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Counter, describeUpdateIncrement } from './update-increment.cases';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Counter],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repository: Repository<Counter>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(Counter);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeUpdateIncrement('the in memory data source', () => repository);