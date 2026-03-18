import { UserServiceInterface } from './user-service.interface';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { GlobalRegistry } from '../../global/global-registry';
import { BaseUser } from '../models/base-user.model';

// eslint-disable-next-line jsdoc/require-jsdoc
export const NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE: string = 'No user repositories have been provided.';

/**
 * Default user service implementation of Zibri.
 */
@Injectable()
export class UserService implements UserServiceInterface {

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findById<Role extends string, T extends BaseUser<Role>>(id: T['id']): Promise<T> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        try {
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findById(id))) as unknown as T;
        }
        catch {
            throw new NotFoundError(`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findByEmail<Role extends string, T extends BaseUser<Role>>(mail: string): Promise<T> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        try {
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findByEmail(mail))) as unknown as T;
        }
        catch {
            throw new NotFoundError(`Could not find user with email "${mail}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialsFor<Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T): Promise<CredentialsType> {
        if (!GlobalRegistry.userRepositories.length) {
            throw new Error(NO_USER_REPOSITORIES_PROVIDED_ERROR_MESSAGE);
        }
        try {
            // eslint-disable-next-line typescript/no-unsafe-return
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).resolveCredentialsFor(user)));
        }
        catch {
            throw new NotFoundError(`Could not resolve credentials for user with email "${user.email}".`);
        }
    }
}