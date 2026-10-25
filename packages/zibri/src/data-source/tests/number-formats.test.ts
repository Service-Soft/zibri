import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeNumberFormats, Measurement } from './number-formats.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Measurement],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repository: Repository<Measurement>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(Measurement);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeNumberFormats('the in memory data source', () => repository);