import { BaseUser } from './models';

export interface UserServiceInterface {
    findById: <Role extends string, T extends BaseUser<Role>>(id: T['id']) => Promise<T>,
    findByEmail: <Role extends string, T extends BaseUser<Role>>(email: string) => Promise<T>,
    resolveCredentialsFor: <Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T) => Promise<CredentialsType>
}