import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer } from 'zibri-testing';

import { Contact, describeFuzzySearch } from './fuzzy-search.cases.ts';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity.ts';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity.ts';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: [Contact, JwtUser, TestMembership] });

let server: StartedTestServer | undefined;
let contacts: Repository<Contact>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    contacts = inject(dataSourceClass).getRepository(Contact);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeFuzzySearch('the in memory data source', () => contacts);