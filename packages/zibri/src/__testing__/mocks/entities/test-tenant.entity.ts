import { Entity } from '../../../entity/decorators/entity.decorator';
import { BaseTenantDefinitionEntity } from '../../../tenancy/tenant-definition/base-tenant-definition.model';

/**
 * The tenants of the test fixtures, which can be deactivated and deleted.
 */
// an orphan for every suite that imports a file declaring it without storing it
@Entity({ tenant: 'shared', allowOrphan: true })
export class TestTenant extends BaseTenantDefinitionEntity({ deactivatable: true }) {}