import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeEncryptedItems, Vault } from './encrypted-items.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

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