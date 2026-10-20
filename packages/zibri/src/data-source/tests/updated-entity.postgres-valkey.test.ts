import { afterAll, beforeAll } from 'vitest';

import { describeUpdatedEntity, Seat, Subscription, Team } from './updated-entity.cases.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { inject } from '../../di/inject.function.ts';
import { Newable } from '../../types/newable.type.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model.ts';
import { MigrationEntity } from '../migration/migration-entity.model.ts';
import { Repository } from '../repository/repository.ts';

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