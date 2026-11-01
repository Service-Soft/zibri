import { afterAll, beforeAll } from '@jest/globals';

import { describeForeignTransaction } from './foreign-transaction.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';

// two of each kind, each with a container of its own: a transaction of one postgres data source ran
// its statements in the other's database, and one of a valkey data source wrote on the other's connection
const firstPostgresClass: Newable<PostgresDataSource> = createTestDataSource();

/**
 * The second postgres data source. Named, because a repository is registered under the name of its
 * data source, and the first one's name is taken.
 */
@DataSource()
class SecondPostgresDataSource extends createTestDataSource({ entities: [MigrationEntity], allowOrphan: true }) {}

const secondPostgresClass: Newable<PostgresDataSource> = SecondPostgresDataSource;

const firstValKeyClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({ entities: [MigrationEntity] });

/**
 * The second valkey data source, named for the same reason.
 */
@DataSource()
class SecondValKeyDataSource extends createTestValKeyDataSource({ entities: [MigrationEntity], allowOrphan: true }) {}

const secondValKeyClass: Newable<ValKeyDataSource> = SecondValKeyDataSource;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [firstPostgresClass, secondPostgresClass, firstValKeyClass, secondValKeyClass] });
}, TestTimeouts.resolveCombined('postgres', 'postgres', 'valKey', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'postgres', 'valKey', 'valKey').shutdown);

describeForeignTransaction('postgres', () => ({
    first: inject(firstPostgresClass),
    firstRepository: inject(repositoryTokenFor(MigrationEntity, firstPostgresClass)),
    second: inject(secondPostgresClass),
    secondRepository: inject(repositoryTokenFor(MigrationEntity, secondPostgresClass))
}));

describeForeignTransaction('valkey', () => ({
    first: inject(firstValKeyClass),
    firstRepository: inject(repositoryTokenFor(MigrationEntity, firstValKeyClass)),
    second: inject(secondValKeyClass),
    secondRepository: inject(repositoryTokenFor(MigrationEntity, secondValKeyClass))
}));
