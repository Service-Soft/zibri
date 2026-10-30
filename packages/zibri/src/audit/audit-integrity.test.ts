import { createInMemoryDataSource } from 'zibri-testing';

import { describeAuditIntegrity } from './audit-integrity.cases';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';

// evaluation/round-2/06-infrastructure F26: the trail could be changed past the application unnoticed
describeAuditIntegrity(
    'the in memory data source',
    [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);