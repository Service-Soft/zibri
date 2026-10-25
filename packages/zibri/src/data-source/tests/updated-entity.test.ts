import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUpdatedEntity, Seat, Subscription, Team } from './updated-entity.cases';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Subscription, Team, Seat],
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;
let subscriptions: Repository<Subscription>;
let teams: Repository<Team>;
let seats: Repository<Seat>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
    subscriptions = inject(dataSourceClass).getRepository(Subscription);
    teams = inject(dataSourceClass).getRepository(Team);
    seats = inject(dataSourceClass).getRepository(Seat);
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
});

describeUpdatedEntity('the in memory data source', () => subscriptions, () => teams, () => seats);