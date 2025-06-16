import { inject } from '../di';
import { GlobalRegistry } from '../global';
import { BaseUser } from './models';
import { UserServiceInterface } from './user-service.interface';

export const NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE: string = 'No user repositories have been provided.';

export class UserService implements UserServiceInterface {
    async findById<Role extends string, T extends BaseUser<Role>>(id: T['id']): Promise<T> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findById(id))) as unknown as T;
    }

    async findByEmail<Role extends string, T extends BaseUser<Role>>(email: string): Promise<T> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findByEmail(email))) as unknown as T;
    }

    async resolveCredentialsFor<Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T): Promise<CredentialsType> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        // eslint-disable-next-line typescript/no-unsafe-return
        return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).resolveCredentialsFor(user)));
    }
}