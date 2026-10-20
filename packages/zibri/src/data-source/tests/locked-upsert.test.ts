import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeLockedUpsert, Ledger } from './locked-upsert.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Ledger] });

let server: StartedTestServer | undefined;
let ledgers: Repository<Ledger>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    ledgers = inject(dataSourceClass).getRepository(Ledger);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeLockedUpsert('the in memory data source', () => ledgers);