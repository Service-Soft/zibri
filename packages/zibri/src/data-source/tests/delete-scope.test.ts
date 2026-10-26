import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { deleteScopeHooks, describeDeleteScope, OwnedNote } from './delete-scope.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, OwnedNote],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let notes: Repository<OwnedNote>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        providers: [...defaultTestServerProviders, defineProvider({ token: ZIBRI_DI_TOKENS.REPOSITORY_HOOKS, useValue: deleteScopeHooks })]
    });
    notes = inject(dataSourceClass).getRepository(OwnedNote);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeDeleteScope('the in memory data source', () => notes);
