import { TestTimeouts } from '../../__testing__/constants';
import { TestInvitation } from '../../__testing__/mocks/entities/test-invitation.entity';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { projectsTestEntities } from './projects.cases';
import { describeRecurringTasks } from './recurring-tasks.cases';

describeRecurringTasks(
    'postgres',
    [
        createTestDataSource({
        // without the invitations, which nothing here sends
            entities: [...defaultTestServerEntities, ...projectsTestEntities.filter(entity => entity !== TestInvitation)],
            repositories: defaultTestServerRepositories
        })
    ],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);