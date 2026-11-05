import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { BoundedRow, describeBoundedReturns } from './bounded-returns.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [...defaultTestServerEntities, BoundedRow], repositories: defaultTestServerRepositories });

let server: StartedTestServer | undefined;
let rows: Repository<BoundedRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    rows = inject(dataSourceClass).getRepository(BoundedRow);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeBoundedReturns('the in memory data source', () => rows);