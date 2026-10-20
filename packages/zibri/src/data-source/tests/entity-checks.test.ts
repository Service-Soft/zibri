import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Chore, describeEntityChecks } from './entity-checks.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

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