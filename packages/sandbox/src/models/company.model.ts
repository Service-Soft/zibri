import { BaseEntity, Entity, Property } from 'zibri';

// the tenants of this application: a company's id is the tenant id of everything it holds. Shared,
// because the companies are what every request picks its tenant from
@Entity({ tenant: 'shared', defaultOrder: { name: 'ASC' } })
export class Company extends BaseEntity {
    @Property.string({ unique: true })
    name!: string;
}