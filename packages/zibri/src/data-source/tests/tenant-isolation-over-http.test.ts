import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { describeTenantIsolationOverHttp, tenantIsolationOverHttpEntities } from './tenant-isolation-over-http.cases';

describeTenantIsolationOverHttp(
    'the in memory data source',
    createInMemoryDataSource({ entities: tenantIsolationOverHttpEntities, repositories: defaultTestServerRepositories })
);