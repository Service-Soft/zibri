import { UserServiceInterface } from './user-service.interface';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseUser } from '../models/base-user.model';

/**
 * An error to throw when there are no user repositories provided.
 */
class NoUserRepositoriesProvidedError extends InternalError {
    constructor(options?: ErrorOptions) {
        super('No user repositories have been provided.', options);
        this.name = 'NoUserRepositoriesProvidedError';
    }
}

/**
 * Default user service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class UserService implements UserServiceInterface {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findById<Role extends string, T extends BaseUser<Role>>(id: T['id']): Promise<T> {
        try {
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findById(id))) as unknown as T;
        }
        catch {
            if (!GlobalRegistry.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findByEmail<Role extends string, T extends BaseUser<Role>>(mail: string): Promise<T> {
        try {
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).findByEmail(mail))) as unknown as T;
        }
        catch {
            if (!GlobalRegistry.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not find user with email "${mail}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialsFor<Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T): Promise<CredentialsType> {
        try {
            // eslint-disable-next-line typescript/no-unsafe-return
            return await Promise.any(GlobalRegistry.userRepositories.map(r => inject(r).resolveCredentialsFor(user)));
        }
        catch {
            if (!GlobalRegistry.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not resolve credentials for user with email "${user.email}".`);
        }
    }
}