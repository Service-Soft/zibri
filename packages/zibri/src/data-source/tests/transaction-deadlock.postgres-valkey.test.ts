import { afterAll, beforeAll } from '@jest/globals';

import { ContendedRow, describeTransactionDeadlock } from './transaction-deadlock.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';
import { Repository } from '../repository/repository';

/**
 * A deadlock on valkey, beside postgres: a cycle of valkey transactions ran every one of them into
 * the lock timeout, ten seconds later, where postgres fails one of them within a second and the
 * other commits.
 */

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ContendedRow],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, ContendedRow]
});

let server: StartedTestServer | undefined;
let postgres: Repository<ContendedRow>;
let valKey: Repository<ContendedRow>;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    postgres = inject(postgresDataSourceClass).getRepository(ContendedRow);
    valKey = inject(valKeyDataSourceClass).getRepository(ContendedRow);
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeTransactionDeadlock('postgres', () => postgres);

describeTransactionDeadlock('valkey', () => valKey);