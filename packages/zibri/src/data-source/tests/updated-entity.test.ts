import { afterAll, beforeAll } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, StartedTestServer, startTestServer } from 'zibri-testing';

import { describeUpdatedEntity, Seat, Subscription, Team } from './updated-entity.cases';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { Repository } from '../repository/repository';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [Subscription, Team, Seat]
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