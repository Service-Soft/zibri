import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { describeInvitations } from './invitation.cases';

describeInvitations(
    'the in memory data source',
    [createInMemoryDataSource({ entities: [...defaultTestServerEntities, TestInvitation], repositories: [...defaultTestServerRepositories, TestServerInvitationRepository] })],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);