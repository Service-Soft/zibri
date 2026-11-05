import { afterAll, beforeAll } from '@jest/globals';

import { describeAbandonedTransactionLease } from './abandoned-transaction-lease.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: [MigrationEntity] });

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeAbandonedTransactionLease('postgres', () => inject(postgresDataSourceClass));

describeAbandonedTransactionLease('valkey', () => inject(valKeyDataSourceClass));