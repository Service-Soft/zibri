import { TestTimeouts } from '../../__testing__/constants';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { PostgresDataSource } from '../../data-source/data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../../data-source/data-sources/val-key/val-key-data-source.model';
import { MigrationEntity } from '../../data-source/migration/migration-entity.model';
import { Newable } from '../../types/newable.type';
import { describeInvitations } from './invitation.cases';

// each handed to one of the two servers below, so each is declared without the other using it
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, TestInvitation],
    repositories: [...defaultTestServerRepositories, TestServerInvitationRepository],
    allowOrphan: true
});

const postgresWithoutInvitationsDataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    allowOrphan: true
});

// the invitations in Valkey, and the users and memberships they create in Postgres
const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource({
    entities: [MigrationEntity, TestInvitation],
    repositories: [TestServerInvitationRepository],
    allowOrphan: true
});

describeInvitations(
    'postgres',
    [postgresDataSourceClass],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);

describeInvitations(
    'valkey',
    [postgresWithoutInvitationsDataSourceClass, valKeyDataSourceClass],
    TestTimeouts.resolveCombined('postgres', 'valKey').start,
    TestTimeouts.resolveCombined('postgres', 'valKey').shutdown
);