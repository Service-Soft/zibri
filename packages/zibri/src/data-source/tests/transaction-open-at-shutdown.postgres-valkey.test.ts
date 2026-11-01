import { describeTransactionOpenAtShutdown } from './transaction-open-at-shutdown.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { createTestDataSource } from '../../__testing__/test-server/create-test-data-source.function';
import { createTestValKeyDataSource } from '../../__testing__/test-server/create-test-val-key-data-source.function';
import { Newable } from '../../types/newable.type';
import { PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';

// both cases boot the same two data sources, one application after the other
const postgresDataSourceClass: Newable<PostgresDataSource> = createTestDataSource();

const valKeyDataSourceClass: Newable<ValKeyDataSource> = createTestValKeyDataSource();

describeTransactionOpenAtShutdown('postgres', {
    dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
    dataSource: postgresDataSourceClass,
    timeouts: TestTimeouts.resolveCombined('postgres', 'valKey')
});

describeTransactionOpenAtShutdown('valkey', {
    dataSources: [postgresDataSourceClass, valKeyDataSourceClass],
    dataSource: valKeyDataSourceClass,
    timeouts: TestTimeouts.resolveCombined('postgres', 'valKey')
});
