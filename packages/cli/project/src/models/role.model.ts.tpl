import { BaseRoleEntity, Entity, Property } from 'zibri';

// the roles users and memberships hold: one every tenant shares, or one of a tenant's own
@Entity()
export class Role extends BaseRoleEntity {
    @Property.string({ required: false })
    description: string | undefined | null;
}
