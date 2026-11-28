import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { describeProjectsCalendarSync, projectsCalendarSyncTestEntities } from './projects-calendar-sync.cases';

describeProjectsCalendarSync(
    'the in memory data source',
    [
        createInMemoryDataSource({
            entities: [...defaultTestServerEntities, ...projectsCalendarSyncTestEntities],
            repositories: defaultTestServerRepositories
        })
    ],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);