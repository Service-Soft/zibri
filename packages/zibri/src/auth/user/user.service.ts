import { isUserRepository, UserRepositoryInterface } from './user-repository.interface';
import { FindUserOptions, UserServiceInterface } from './user-service.interface';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { getAllInstantiatedValues } from '../../di/get-all-instantiated-values.function';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { ErrorUtilities } from '../../error-handling/error.utilities';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly userRepositories: UserRepositoryInterface<string, BaseUser<string>>[] = [];

    /**
     * The entities whose rows are users, because a user repository built on the data layer reads them.
     */
    private readonly userEntities: Set<Newable<BaseEntity>> = new Set();

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(): void {
        const repoProviders: DiProvider<unknown>[] = getRegisteredProvidersOfVariant(DiVariants.USER_REPO);
        if (repoProviders.length) {
            this.logger.info(`configures ${repoProviders.length} user ${repoProviders.length > 1 ? 'repositories' : 'repository'}:`);
        }

        for (const provider of repoProviders) {
            const repo: unknown = inject(provider.token);
            if (!isUserRepository(repo)) {
                throw new InitUserServiceError(
                    `Invalid class marked with @UserRepo: ${getDiTokenName(provider.token)} needs to implement UserRepositoryInterface`
                );
            }
            this.userRepositories.push(repo);
            // a repository of the data layer names its entity. One that is not reads its users from
            // somewhere no repository deletes them in, so there is nothing to follow a deletion of
            if (repo instanceof Repository) {
                this.userEntities.add(repo.entityClass);
            }
            this.logger.info(`  - ${getDiTokenName(provider.token)}`);
        }

        // among what the application has actually built, rather than everything registered - see
        // `CacheService.onAppInit` for why the second question is the expensive one
        const repositories: UserRepositoryInterface<string, BaseUser<string>>[] = getAllInstantiatedValues()
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
    async findById<Role extends string, T extends BaseUser<Role>, B extends boolean = true>(
        id: T['id'],
        options?: FindUserOptions<B>
    ): Promise<B extends false ? T | undefined : T> {
        const found: BaseUser<string> | undefined = await this.resolveFromAnyRepository(
            this.userRepositories.map(r => r.findById(id))
        );
        if (found != undefined) {
            return found as unknown as T;
        }
        if (options?.required === false) {
            return undefined as B extends false ? T | undefined : T;
        }
        throw new NotFoundError($ts`Could not find user with id "${id}".`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findByEmail<Role extends string, T extends BaseUser<Role>, B extends boolean = true>(
        mail: string,
        options?: FindUserOptions<B>
    ): Promise<B extends false ? T | undefined : T> {
        const found: BaseUser<string> | undefined = await this.resolveFromAnyRepository(
            this.userRepositories.map(r => r.findByEmail(mail))
        );
        if (found != undefined) {
            return found as unknown as T;
        }
        if (options?.required === false) {
            return undefined as B extends false ? T | undefined : T;
        }
        throw new NotFoundError($ts`Could not find user with email "${mail}".`);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {
        // every repository asked to write, inside the transaction, and the one holding the user does:
        // the others refuse an id that is not theirs. Finding the holder first would look outside the
        // transaction, where a user it has just created is not there yet
        const written: true | undefined = await this.resolveFromAnyRepository(
            this.userRepositories.map(async r => {
                await r.updateDeactivatedAt(id, deactivatedAt, transaction);
                return true as const;
            })
        );
        if (written == undefined) {
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isUserEntity(entityClass: Newable<BaseEntity>): boolean {
        return this.userEntities.has(entityClass);
    }

    /**
     * Resolves the first answer any user repository gives.
     *
     * Every repository is asked at once, because a user lives in exactly one of them and which one is
     * not known up front.
     * @param lookups - The same question, asked of each repository.
     * @returns The first value found, or undefined when every repository said it has none.
     * @throws The first failure that is not a refusal, when no repository found anything. A store
     * that could not be reached cannot say the user is not there.
     */
    private async resolveFromAnyRepository<T>(lookups: Promise<T>[]): Promise<T | undefined> {
        if (!lookups.length) {
            this.logger.error(new NoUserRepositoriesProvidedError());
            return undefined;
        }
        try {
            return await Promise.any(lookups);
        }
        catch (error) {
            // every rejection used to become "not found", so a store that was down answered exactly
            // like an address nobody registered: a login was refused as a wrong password, and the
            // audit trail read an outage as somebody guessing
            const errors: unknown[] = error instanceof AggregateError ? error.errors : [error];
            const faults: unknown[] = errors.filter(e => !ErrorUtilities.isRefusal(e));
            if (!faults.length) {
                return undefined;
            }
            const [fault] = faults;
            throw ErrorUtilities.isError(fault) ? fault : new InternalError(ErrorUtilities.unknownToErrorString(fault));
        }
    }
}