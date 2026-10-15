import { BaseUserEntity, Entity, IntersectionClass, OmitClass, OmitStrict, PasswordCredentials, Property } from 'zibri';

import { Roles } from './roles.enum';

// 'shared' because one user can be member in multiple tenants
@Entity({ tenant: 'shared' })
export class User extends BaseUserEntity(Roles) {
    @Property.string()
    name!: string;
}

export class UserCreateDto extends IntersectionClass(
    OmitClass(User, ['id', 'roles']),
    OmitClass(PasswordCredentials, ['id', 'userId'])
) {}

export type UserCreateData = OmitStrict<User, 'id'>;