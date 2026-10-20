import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUpsertAll, Tally } from './upsert-all.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

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