import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource, defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { describeProjectsCalendarSync, projectsCalendarSyncTestEntities } from './projects-calendar-sync.cases';

describeProjectsCalendarSync(
    'postgres',
    [createTestDataSource({
        entities: [...defaultTestServerEntities, ...projectsCalendarSyncTestEntities],
        repositories: defaultTestServerRepositories
    })],
    TestTimeouts.postgres.start,
    TestTimeouts.postgres.shutdown
);
