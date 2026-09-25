import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { describePartialUniqueUpsert, Slot } from './partial-unique-upsert.cases';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [Slot] });

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