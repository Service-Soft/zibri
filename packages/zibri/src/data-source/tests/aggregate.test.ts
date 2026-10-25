import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeAggregates, Sale } from './aggregate.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Sale],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repository: Repository<Sale>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(Sale);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeAggregates('the in memory data source', () => repository);