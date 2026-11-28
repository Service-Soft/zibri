import { TestTimeouts } from '../__testing__/constants';
import { TestInvitation } from '../__testing__/mocks/entities/test-invitation.entity';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../__testing__/test-server/invitation-repository';
import { LoginLinkToken } from '../auth/authenticators/login-link/login-link-token.model';
import { ApiKey } from '../auth/strategies/api-key/api-key.model';
import { describeSharing, sharingEntities } from './sharing.cases';

describeSharing(
    'postgres',
    [createTestDataSource({
        entities: [...defaultTestServerEntities, ...sharingEntities, ApiKey, LoginLinkToken, TestInvitation],
        repositories: [...defaultTestServerRepositories, TestServerInvitationRepository]
    })],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);
