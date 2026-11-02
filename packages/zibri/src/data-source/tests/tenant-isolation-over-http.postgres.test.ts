import { describeTenantIsolationOverHttp, tenantIsolationOverHttpEntities } from './tenant-isolation-over-http.cases';
import { createTestDataSource, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';

describeTenantIsolationOverHttp('postgres', createTestDataSource({ entities: tenantIsolationOverHttpEntities, repositories: defaultTestServerRepositories }));