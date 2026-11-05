import { AuditCheckpoint } from './audit-checkpoint.model';
import { AuditEntry } from './audit-entry.model';
import { describeAuditIntegrity } from './audit-integrity.cases';
import { TestTimeouts } from '../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../__testing__/test-server/create-test-val-key-data-source.function';
import { PostgresDataSource } from '../data-source/data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { Newable } from '../types/newable.type';

// each handed to one of the two servers below, so each is declared without the other using it
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

const postgresWithoutTrailDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: defaultTestServerEntities.filter(e => e !== AuditEntry && e !== AuditCheckpoint),
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

// the signing keys and the anchors are kept in postgres, which the audit service finds wherever they are
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, AuditEntry, AuditCheckpoint],
    allowOrphan: true
});

describeAuditIntegrity(
    'postgres',
    [postgresDataSourceClass],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);

describeAuditIntegrity(
    'valkey',
    [postgresWithoutTrailDataSourceClass, valKeyDataSourceClass],
    TestTimeouts.resolveCombined('postgres', 'valKey').start,
    TestTimeouts.resolveCombined('postgres', 'valKey').shutdown
);