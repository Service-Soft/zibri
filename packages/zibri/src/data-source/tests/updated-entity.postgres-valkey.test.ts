import { afterAll, beforeAll } from '@jest/globals';

import { describeUpdatedEntity, Seat, Subscription, Team } from './updated-entity.cases';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, Subscription, Team, Seat]
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Subscription, Team, Seat]
});

let server: StartedTestServer | undefined;
let postgresSubscriptions: Repository<Subscription>;
let postgresTeams: Repository<Team>;
let postgresSeats: Repository<Seat>;
let valKeySubscriptions: Repository<Subscription>;
let valKeyTeams: Repository<Team>;
let valKeySeats: Repository<Seat>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgresSubscriptions = inject(postgresDataSourceClass).getRepository(Subscription);
    postgresTeams = inject(postgresDataSourceClass).getRepository(Team);
    postgresSeats = inject(postgresDataSourceClass).getRepository(Seat);
    valKeySubscriptions = inject(valKeyDataSourceClass).getRepository(Subscription);
    valKeyTeams = inject(valKeyDataSourceClass).getRepository(Team);
    valKeySeats = inject(valKeyDataSourceClass).getRepository(Seat);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 30000);

describeUpdatedEntity('postgres', () => postgresSubscriptions, () => postgresTeams, () => postgresSeats);

describeUpdatedEntity('valkey', () => valKeySubscriptions, () => valKeyTeams, () => valKeySeats);