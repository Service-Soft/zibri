import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer } from 'zibri-testing';

import { Contact, describeFuzzySearch } from './fuzzy-search.cases';
import { JwtUser } from '../../__testing__/mocks/entities/jwt-user.entity';
import { TestMembership } from '../../__testing__/mocks/entities/test-membership.entity';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

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