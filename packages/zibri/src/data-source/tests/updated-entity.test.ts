import { afterAll, beforeAll } from 'vitest';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeUpdatedEntity, Seat, Subscription, Team } from './updated-entity.cases.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { Repository } from '../repository/repository.ts';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, Subscription, Team, Seat]
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
}, 15000);

afterAll(async () => {
    await server?.shutdown();
});

describeUpdatedEntity('the in memory data source', () => subscriptions, () => teams, () => seats);