import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describePartialUniqueUpsert, Slot } from './partial-unique-upsert.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Slot] });

let server: StartedTestServer | undefined;
let slots: Repository<Slot>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    slots = inject(dataSourceClass).getRepository(Slot);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describePartialUniqueUpsert('the in memory data source', () => slots);