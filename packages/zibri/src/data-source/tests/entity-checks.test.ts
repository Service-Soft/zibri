import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Chore, describeEntityChecks } from './entity-checks.cases';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Chore] });

let server: StartedTestServer | undefined;
let chores: Repository<Chore>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    chores = inject(dataSourceClass).getRepository(Chore);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeEntityChecks('the in memory data source', () => chores);