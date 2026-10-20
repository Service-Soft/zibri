import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeEncryptedItems, Vault } from './encrypted-items.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Vault] });

let server: StartedTestServer | undefined;
let vaults: Repository<Vault>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    vaults = inject(dataSourceClass).getRepository(Vault);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeEncryptedItems('the in memory data source', () => vaults);