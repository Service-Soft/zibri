import { createInMemoryDataSource } from 'zibri-testing';

import { describeTenantIsolationOverHttp, tenantIsolationOverHttpEntities } from './tenant-isolation-over-http.cases';
import { defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';

describeTenantIsolationOverHttp(
    'the in memory data source',
    createInMemoryDataSource({ entities: tenantIsolationOverHttpEntities, repositories: defaultTestServerRepositories })
);