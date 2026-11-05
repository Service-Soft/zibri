import { BaseEntity, Entity, Property } from 'zibri';

// the tenants of this application: a tenant's id is the tenant id of everything it holds. Shared,
// because the tenants are what every request picks its tenant from
@Entity({ tenant: 'shared', defaultOrder: { name: 'ASC' } })
export class Tenant extends BaseEntity {
    @Property.string({ unique: true })
    name!: string;
}
