import { afterAll, beforeAll } from '@jest/globals';

import { BulkOwner, BulkRow, describeLargeBatches, LargeBatchRepositories } from './large-batches.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../migration/migration-entity.model';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, BulkOwner, BulkRow],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, BulkOwner, BulkRow]
});

let server: StartedTestServer | undefined;
let postgres: LargeBatchRepositories;
let valKey: LargeBatchRepositories;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass] });
    const postgresDataSource: PostgresDataSource = inject(postgresDataSourceClass);
    const valKeyDataSource: ValKeyDataSource = inject(valKeyDataSourceClass);
    postgres = {
        owners: postgresDataSource.getRepository(BulkOwner),
        rows: postgresDataSource.getRepository(BulkRow)
    };
    valKey = {
        owners: valKeyDataSource.getRepository(BulkOwner),
        rows: valKeyDataSource.getRepository(BulkRow)
    };
}, TestTimeouts.resolveCombined('postgres', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey').shutdown);

describeLargeBatches('postgres', () => postgres);

describeLargeBatches('valkey', () => valKey);