import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUpsertAll, Tally } from './upsert-all.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Tally] });

let server: StartedTestServer | undefined;
let tallies: Repository<Tally>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    tallies = inject(dataSourceClass).getRepository(Tally);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeUpsertAll('the in memory data source', () => tallies);