import { afterAll, beforeAll } from '@jest/globals';
import { RoundTripCounter } from 'zibri-testing';

import { CostGroup, CostItem, describeRepositoryCosts } from './repository-costs.cases';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { TestTimeouts } from '../../__testing__/constants';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresRoundTrips: RoundTripCounter = new RoundTripCounter();
const valKeyRoundTrips: RoundTripCounter = new RoundTripCounter();

// the framework's own entities live in a data source of their own, so that no service of the
// application - a cron poll, a lease being renewed - sends anything through the counted ones
const frameworkDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [MigrationEntity, CostGroup, CostItem],
    roundTrips: postgresRoundTrips
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, CostGroup, CostItem],
    roundTrips: valKeyRoundTrips
});

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [frameworkDataSourceClass, postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeRepositoryCosts('Postgres', () => ({
    items: inject(postgresDataSourceClass).getRepository(CostItem),
    groups: inject(postgresDataSourceClass).getRepository(CostGroup),
    roundTrips: postgresRoundTrips
}));

describeRepositoryCosts('ValKey', () => ({
    items: inject(valKeyDataSourceClass).getRepository(CostItem),
    groups: inject(valKeyDataSourceClass).getRepository(CostGroup),
    roundTrips: valKeyRoundTrips
}));