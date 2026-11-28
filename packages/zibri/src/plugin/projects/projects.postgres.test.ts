import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { describeProjects, projectsTestEntities } from './projects.cases';

describeProjects(
    'postgres',
    [createTestDataSource({
        entities: [...defaultTestServerEntities, ...projectsTestEntities],
        repositories: [...defaultTestServerRepositories, TestServerInvitationRepository]
    })],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);
