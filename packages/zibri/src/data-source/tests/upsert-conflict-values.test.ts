import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Credential, describeUpsertConflictValues } from './upsert-conflict-values.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, Credential] });

let server: StartedTestServer | undefined;
let credentials: Repository<Credential>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    credentials = inject(dataSourceClass).getRepository(Credential);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeUpsertConflictValues('the in memory data source', () => credentials);