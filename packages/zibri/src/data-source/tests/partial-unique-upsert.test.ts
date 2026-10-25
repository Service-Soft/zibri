import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describePartialUniqueUpsert, Slot } from './partial-unique-upsert.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Slot], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let slots: Repository<Slot>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    slots = inject(dataSourceClass).getRepository(Slot);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describePartialUniqueUpsert('the in memory data source', () => slots);