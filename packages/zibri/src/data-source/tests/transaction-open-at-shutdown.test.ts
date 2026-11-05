import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { describeTransactionOpenAtShutdown } from './transaction-open-at-shutdown.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { Newable } from '../../types/newable.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories });

describeTransactionOpenAtShutdown('the in memory data source', {
    dataSources: [dataSourceClass],
    dataSource: dataSourceClass,
    timeouts: TestTimeouts.inMemory
});