import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeNullableUnique, OptionalCode } from './nullable-unique.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, OptionalCode]
});

let server: StartedTestServer | undefined;
let repository: Repository<OptionalCode>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(OptionalCode);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeNullableUnique('the in memory data source', () => repository);