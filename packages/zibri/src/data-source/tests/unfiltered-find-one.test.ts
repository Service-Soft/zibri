import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUnfilteredFindOne, SingleRow } from './unfiltered-find-one.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, SingleRow],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let repository: Repository<SingleRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    repository = inject(dataSourceClass).getRepository(SingleRow);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeUnfilteredFindOne('the in memory data source', () => repository);