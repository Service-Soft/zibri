import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { TestTenant } from '../../__testing__/mocks/entities/test-tenant.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { describeTenants, TenantTestProject, TenantTestTask } from './tenant-definition.cases';
import { TenantDeletion } from './tenant-deletion.model';

const entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, TestTenant, TenantDeletion, ApiKey, TenantTestProject, TenantTestTask];

describeTenants(
    'the in memory data source',
    [createInMemoryDataSource({ entities, repositories: defaultTestServerRepositories })],
    TestTimeouts.inMemory.start,
    TestTimeouts.inMemory.shutdown
);