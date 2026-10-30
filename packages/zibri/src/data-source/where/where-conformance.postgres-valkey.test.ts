import { afterAll, beforeAll } from '@jest/globals';

import { describeWhereConformance, Probe, ProbeChild, whereConformanceEntities, WhereConformanceRepositories } from './where-conformance.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...whereConformanceEntities],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ...whereConformanceEntities]
});

let server: StartedTestServer | undefined;
let postgres: WhereConformanceRepositories;
let valKey: WhereConformanceRepositories;

/**
 * Reads the repositories the cases run against off one data source.
 * @param dataSource - The started data source.
 * @returns Its repositories.
 */
function repositoriesOf(dataSource: DataSourceInterface): WhereConformanceRepositories {
    return { probes: dataSource.getRepository(Probe), children: dataSource.getRepository(ProbeChild) };
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = repositoriesOf(inject(postgresDataSourceClass));
    valKey = repositoriesOf(inject(valKeyDataSourceClass));
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeWhereConformance('postgres', () => postgres);

describeWhereConformance('valkey', () => valKey);