import { TestTimeouts } from '../../__testing__/constants';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Newable } from '../../types/newable.type';
import { describeTenants, TenantTestProject, TenantTestTask } from './tenant-definition.cases';
import { TenantDeletion } from './tenant-deletion.model';

// each handed to one of the two servers below, so each is declared without the other using it
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TestTenant, TenantDeletion, ApiKey, TenantTestProject, TenantTestTask],
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

const postgresBesideValKeyDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TestTenant, TenantDeletion, ApiKey],
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

// the rows of the tenant in Valkey, and its tenant, members and queues in Postgres: one deletion reaches both
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, TenantTestProject, TenantTestTask],
    allowOrphan: true
});

describeTenants(
    'postgres',
    [postgresDataSourceClass],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);

describeTenants(
    'postgres and valkey',
    [postgresBesideValKeyDataSourceClass, valKeyDataSourceClass],
    TestTimeouts.resolveCombined('postgres', 'valKey').start,
    TestTimeouts.resolveCombined('postgres', 'valKey').shutdown
);