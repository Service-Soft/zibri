import { BaseUser } from './models';

/**
 * Interface for a User Repository.
 */
export interface UserRepositoryInterface<RoleType extends string, UserType extends BaseUser<RoleType>, CredentialsType> {
    /**
     * Finds a by the provided id.
     */
    findById: (id: UserType['id']) => Promise<UserType>,
    /**
     * Finds a user by the provided email.
     */
    findByEmail: (mail: UserType['email']) => Promise<UserType>,
    /**
     * Resolves the credentials for the given user.
     */
    resolveCredentialsFor: (user: UserType) => Promise<CredentialsType>
}