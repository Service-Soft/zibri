import { BaseUserEntity, Entity, IntersectionClass, OmitClass, PasswordCredentials, Property } from 'zibri';

// 'shared' because one user can be member in multiple tenants. Its roles are the names of roles
@Entity({ tenant: 'shared' })
export class User extends BaseUserEntity() {
    @Property.string()
    name!: string;
}

export class UserCreateDto extends IntersectionClass(
    OmitClass(User, ['id', 'roles']),
    OmitClass(PasswordCredentials, ['id', 'userId'])
) {}

export type UserCreateData = Omit<User, 'id'>;
