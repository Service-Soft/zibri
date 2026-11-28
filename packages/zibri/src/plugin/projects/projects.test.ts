import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { TestServerInvitationRepository } from '../../__testing__/test-server/invitation-repository';
import { describeProjects, projectsTestEntities } from './projects.cases';

describeProjects(
    'the in memory data source',
    [createInMemoryDataSource({
        entities: [...defaultTestServerEntities, ...projectsTestEntities],
        repositories: [...defaultTestServerRepositories, TestServerInvitationRepository]
    })],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);
