import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeLockedUpsert, Ledger } from './locked-upsert.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

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