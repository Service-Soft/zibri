import { afterAll, beforeAll } from '@jest/globals';

import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { ChangeSet } from '../change-sets/models/change-set.model';
import { Change } from '../change-sets/models/change.model';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { describeTenantRows, describeTenantRowsAsOfOneMoment, TENANT_ROWS_ENTITIES } from './tenant-rows.cases';

const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, ...TENANT_ROWS_ENTITIES],
    repositories: defaultTestServerRepositories
});

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, Change, ChangeSet, ...TENANT_ROWS_ENTITIES]
});

/**
 * Writes the rows back a batch at a time rather than in one transaction. A class of its own, since data
 * sources are told apart by name.
 */
@DataSource()
class DirectValKeyDataSource extends createTestValKeyDataSource({
        entities: [MigrationEntity, Change, ChangeSet, ...TENANT_ROWS_ENTITIES],
        restoreMode: 'direct',
        allowOrphan: true
    }) {}

const directValKeyDataSourceClass: Newable<ValKeyDataSource> = DirectValKeyDataSource;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [postgresDataSourceClass, valKeyDataSourceClass, directValKeyDataSourceClass] });
}, TestTimeouts.resolveCombined('postgres', 'valKey', 'valKey').start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.resolveCombined('postgres', 'valKey', 'valKey').shutdown);

describeTenantRows('postgres', () => inject(postgresDataSourceClass));

describeTenantRowsAsOfOneMoment('postgres', () => inject(postgresDataSourceClass));

describeTenantRows('valkey', () => inject(valKeyDataSourceClass));

describeTenantRowsAsOfOneMoment('valkey', () => inject(valKeyDataSourceClass));

describeTenantRows('valkey, restored directly', () => inject(directValKeyDataSourceClass));