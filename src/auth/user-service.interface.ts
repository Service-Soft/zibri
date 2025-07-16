import { BaseUser } from './models';

/**
 * Interface for a user service.
 */
export interface UserServiceInterface {
    /**
     * Finds a user by the given id.
     */
    findById: <Role extends string, T extends BaseUser<Role>>(id: T['id']) => Promise<T>,
    /**
     * Finds a user by the given email.
     */
    findByEmail: <Role extends string, T extends BaseUser<Role>>(email: string) => Promise<T>,
    /**
     * Resolves the credentials for the provided user.
     */
    resolveCredentialsFor: <Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T) => Promise<CredentialsType>
}