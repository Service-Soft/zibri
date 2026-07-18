import { isUserRepository, UserRepositoryInterface } from './user-repository.interface';
import { UserServiceInterface } from './user-service.interface';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getAllRegisteredTokens } from '../../di/get-all-registered-tokens.function';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { BaseUser } from '../models/base-user.model';

/**
 * An error to throw during user service initialization.
 */
class InitUserServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing user service.', ...messageArray]);
        this.name = 'InitUserServiceError';
    }
}

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
export class UserService implements UserServiceInterface, OnAppInit {

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/no-explicit-any
    readonly userRepositories: UserRepositoryInterface<string, BaseUser<string>, any>[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        const repoProviders: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.USER_REPO);
        if (repoProviders.length) {
            await this.logger.info(`configures ${repoProviders.length} user ${repoProviders.length > 1 ? 'repositories' : 'repository'}:`);
        }

        for (const provider of repoProviders) {
            const repo: unknown = inject(provider.token);
            if (!isUserRepository(repo)) {
                throw new InitUserServiceError(
                    `Invalid class marked with @UserRepo: ${getDiTokenName(provider.token)} needs to implement UserRepositoryInterface`
                );
            }
            this.userRepositories.push(repo);
            await this.logger.info(`  - ${getDiTokenName(provider.token)}`);
        }

        // eslint-disable-next-line typescript/no-explicit-any
        const repositories: UserRepositoryInterface<string, BaseUser<string>, any>[] = getAllRegisteredTokens()
            .map(t => inject(t))
            .filter(i => isUserRepository(i));

        for (const repository of repositories) {
            if (!this.userRepositories.find(c => c.constructor.name === repository.constructor.name)) {
                throw new InitUserServiceError(
                    `The class "${repository.constructor.name}" seems to be a user repository but has not been decorated with @UserRepo()`
                );
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findById<Role extends string, T extends BaseUser<Role>>(id: T['id']): Promise<T> {
        try {
            return await Promise.any(this.userRepositories.map(r => r.findById(id))) as unknown as T;
        }
        catch {
            if (!this.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findByEmail<Role extends string, T extends BaseUser<Role>>(mail: string): Promise<T> {
        try {
            return await Promise.any(this.userRepositories.map(r => r.findByEmail(mail))) as unknown as T;
        }
        catch {
            if (!this.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not find user with email "${mail}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveCredentialsFor<Role extends string, T extends BaseUser<Role>, CredentialsType>(user: T): Promise<CredentialsType> {
        try {
            // eslint-disable-next-line typescript/no-unsafe-return
            return await Promise.any(this.userRepositories.map(r => r.resolveCredentialsFor(user)));
        }
        catch {
            if (!this.userRepositories.length) {
                await this.logger.error(new NoUserRepositoriesProvidedError());
            }
            throw new NotFoundError($ts`Could not resolve credentials for user with email "${user.email}".`);
        }
    }
}