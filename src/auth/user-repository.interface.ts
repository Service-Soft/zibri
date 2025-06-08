import { BaseUser } from './models';

export interface UserRepositoryInterface<RoleType extends string, UserType extends BaseUser<RoleType>, CredentialsType> {
    findById: (id: UserType['id']) => Promise<UserType>,
    findByEmail: (email: UserType['email']) => Promise<UserType>,
    resolveCredentialsFor: (user: UserType) => Promise<CredentialsType>
}