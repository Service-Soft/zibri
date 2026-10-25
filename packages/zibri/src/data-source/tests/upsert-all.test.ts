import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUpsertAll, Tally } from './upsert-all.cases';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Tally], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let tallies: Repository<Tally>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    tallies = inject(dataSourceClass).getRepository(Tally);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeUpsertAll('the in memory data source', () => tallies);