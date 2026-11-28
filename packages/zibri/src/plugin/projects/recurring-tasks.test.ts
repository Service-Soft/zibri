import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { projectsTestEntities } from './projects.cases';
import { describeRecurringTasks } from './recurring-tasks.cases';

describeRecurringTasks(
    'the in memory data source',
    [
        createInMemoryDataSource({
        // without the invitations, which nothing here sends
            entities: [...defaultTestServerEntities, ...projectsTestEntities.filter(entity => entity !== TestInvitation)],
            repositories: defaultTestServerRepositories
        })
    ],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);