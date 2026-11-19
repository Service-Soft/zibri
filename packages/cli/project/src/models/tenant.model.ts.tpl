import { BaseTenantDefinitionEntity, Entity } from 'zibri';

// the tenants of this application: a tenant's id is the tenant id of everything it holds. Shared,
// because the tenants are what every request picks its tenant from. Deactivatable, so that a tenant
// can be deactivated and deleted
@Entity({ tenant: 'shared', defaultOrder: { name: 'ASC' }, uniques: [['name']] })
export class Tenant extends BaseTenantDefinitionEntity({ deactivatable: true }) {}
