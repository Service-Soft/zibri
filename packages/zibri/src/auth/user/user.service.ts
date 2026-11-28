import { FrameworkColumnUtilities } from '../../data-source/migration/framework-column.utilities';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
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
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { FrameworkEventNames } from '../../event/framework-event-names.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { type LocaleCode } from '../../localization/models/locale-code.model';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { BaseUser } from '../models/base-user.model';
import { RoleUtilities } from '../roles/role.utilities';
import { type ServiceAccountCreateData } from './service-account-create-data.model';
import { UserEventWriteObserver } from './user-event.write-observer';
import { UserKindWriteObserver } from './user-kind.write-observer';
import { isUserRepository, UserRepositoryInterface } from './user-repository.interface';
import { FindUserOptions, UserServiceInterface } from './user-service.interface';
import { UserWriteObserver } from './user.write-observer';

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
 * What the name of a service account is made of: the local part of its address.
 */
const SERVICE_ACCOUNT_NAME: RegExp = /^[\da-z]+(?:-[\da-z]+)*$/;

/**
 * Default user service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class UserService implements UserServiceInterface, OnAppInit {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly userRepositories: UserRepositoryInterface<string, BaseUser<string>>[] = [];

    /**
     * The user repositories, as the repositories of their entities.
     */
    private readonly userEntityRepositories: Repository<BaseUser<string>>[] = [];

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

        const names: FrameworkEventNames = inject(ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES);
        for (const provider of repoProviders) {
            const repo: unknown = inject(provider.token);
            // registered under the variant by its data source, which lists repository classes only
            if (!(repo instanceof Repository) || !isUserRepository(repo)) {
                throw new InitUserServiceError(
                    `Invalid user repository: ${getDiTokenName(provider.token)} needs to extend BaseUserRepository<User>()`
                );
            }
            this.userRepositories.push(repo);
            this.userEntityRepositories.push(repo);
            // given the role service here rather than resolving it per write
            inject(EntityWriteObserverRegistry).register(repo.entityClass, new UserWriteObserver(inject(ZIBRI_DI_TOKENS.ROLE_SERVICE)));
            inject(EntityWriteObserverRegistry).register(repo.entityClass, new UserKindWriteObserver());
            // only when the application named one, since each costs the writes of its kind an event
            if (names.userDeleted != undefined || names.userDeactivated != undefined || names.userReactivated != undefined) {
                inject(EntityWriteObserverRegistry).register(repo.entityClass, new UserEventWriteObserver(names));
            }
            this.logger.info(`  - ${getDiTokenName(provider.token)}`);
        }

        // among what the application has actually built, rather than everything registered - see
        // `CacheService.onAppInit` for why the second question is the expensive one
        const repositories: UserRepositoryInterface<string, BaseUser<string>>[] = getAllInstantiatedValues()
            .filter(i => isUserRepository(i));

        for (const repository of repositories) {
            if (!this.userRepositories.includes(repository)) {
                throw new InitUserServiceError([
                    `The class "${repository.constructor.name}" is a user repository, but no data source lists it in its repositories.`,
                    'Declare it with @RepositoryFor(User), and list it in the repositories of the data source that declares User.'
                ]);
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findById<Role extends string, T extends BaseUser<Role>, B extends boolean = true>(
        id: T['id'],
        options?: FindUserOptions<B>
    ): Promise<B extends false ? T | undefined : T> {
        const found: BaseUser<string> | undefined = await this.resolveFromAnyRepository(
            // in the transaction, for the reason updateDeactivatedAt gives
            this.userRepositories.map(r => r.findById(id, { transaction: options?.transaction }))
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
            this.userRepositories.map(r => r.findByEmail(mail, { transaction: options?.transaction }))
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
    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: RepositoryTransaction | undefined): Promise<void> {
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
    async updateRoles(id: string, roles: string[], transaction: RepositoryTransaction | undefined): Promise<void> {
        // asked of every repository, for the reason updateDeactivatedAt gives
        const written: true | undefined = await this.resolveFromAnyRepository(
            this.userRepositories.map(async r => {
                await r.updateRoles(id, roles, transaction);
                return true as const;
            })
        );
        if (written == undefined) {
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateEmail(
        id: string,
        email: string,
        emailVerifiedAt: Date | null,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        // asked of every repository, for the reason updateDeactivatedAt gives
        const written: true | undefined = await this.resolveFromAnyRepository(
            this.userRepositories.map(async r => {
                await r.updateEmail(id, email, emailVerifiedAt, transaction);
                return true as const;
            })
        );
        if (written == undefined) {
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateLocale(id: string, locale: LocaleCode | null, transaction: RepositoryTransaction | undefined): Promise<void> {
        // exactly one of them rather than one matched to it: what the user chose is what they read back
        const supported: LocaleCode[] = ObjectUtilities.keys(inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).supportedLocales);
        if (locale != undefined && !supported.includes(locale)) {
            throw new BadRequestError($ts`The locale needs to be one of ${supported.join(', ')}.`);
        }
        // a table without the column, of a schema the data source does not manage, would drop it without a word
        for (const repository of this.userEntityRepositories) {
            FrameworkColumnUtilities.validatePresent('Changing the locale of a user', repository.entityClass, 'locale');
        }
        // written by every repository in the transaction, for the reason updateDeactivatedAt gives: the one
        // holding the user writes a row, the others none
        const written: number[] = await Promise.all(this.userEntityRepositories
            .map(async repository => await repository.updateAll({ id }, { locale }, { transaction })));
        if (!written.some(count => count > 0)) {
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    isUserEntity(entityClass: Newable<BaseEntity>): boolean {
        return this.userEntityRepositories.some(repository => repository.entityClass === entityClass);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getUserEntityClasses(): Newable<BaseUser<string>>[] {
        return this.userEntityRepositories.map(repository => repository.entityClass);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findUnknownRoles(known: string[]): Promise<string[]> {
        const found: string[][] = await Promise.all(this.userEntityRepositories
            .map(async repository => await RoleUtilities.resolveUnknownRoles(
                repository.stream({
                    where: { roles: RoleUtilities.whereHoldingUnknownRoles(known) },
                    unscoped: true,
                    autoDecrypt: false
                }),
                known
            )));
        return [...new Set(found.flat())];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async isRoleHeld(role: string): Promise<boolean> {
        const held: number[] = await Promise.all(this.userEntityRepositories
            .map(async repository => await repository.count({ where: { roles: { includes: [role] } }, unscoped: true })));
        return held.some(count => count > 0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* streamUserIds(): AsyncIterable<string> {
        for (const repository of this.userEntityRepositories) {
            for await (const user of repository.streamAsStored({}, undefined)) {
                yield user.id;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findStoredUserIds(userIds: string[]): Promise<string[]> {
        if (!userIds.length) {
            return [];
        }
        const found: unknown[][] = await Promise.all(this.userEntityRepositories
            .map(async repository => await repository.resolveDistinctAsStored('id', { id: { oneOf: userIds } }, undefined)));
        return found.flat().filter(id => typeof id === 'string');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUser(id: string, transaction: RepositoryTransaction | undefined): Promise<void> {
        // through the repository that holds the user, so that what follows a deleted user, such as their
        // memberships and credentials, goes with it, and a user entity that soft deletes keeps the row
        const counts: number[] = await Promise.all(this.userEntityRepositories
            .map(async repository => await repository.count({ where: { id }, transaction })));
        const holder: Repository<BaseUser<string>> | undefined = this.userEntityRepositories.find((_, index) => (counts[index] ?? 0) > 0);
        if (holder == undefined) {
            throw new NotFoundError($ts`Could not find user with id "${id}".`);
        }
        await holder.deleteById(id, { transaction });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createServiceAccount<UserType extends BaseUser<string>>(
        entity: Newable<UserType>,
        data: ServiceAccountCreateData<UserType>,
        transaction: RepositoryTransaction | undefined
    ): Promise<UserType> {
        const { name, ...rest } = data;
        // the name becomes the local part of an address, which stays one of the reserved top level domain .invalid
        // (RFC 2606): whatever mails it, such as code of the application's own, reaches nobody
        if (!SERVICE_ACCOUNT_NAME.test(name)) {
            throw new BadRequestError($ts`The name of a service account needs to be lowercase letters, digits and hyphens between them.`);
        }
        const repository: Repository<BaseUser<string>> | undefined = this.userEntityRepositories.find(r => r.entityClass === entity);
        if (repository == undefined) {
            throw new BadRequestError($ts`The entity "${entity.name}" is not one a user repository reads.`);
        }
        FrameworkColumnUtilities.validatePresent('Creating a service account', entity, 'kind');
        // the repository holds rows of exactly this entity, so what it creates is one of it
        return await repository.create(
            { ...rest, email: `${name}@service-accounts.invalid`, kind: 'service', emailVerifiedAt: null },
            { transaction }
        ) as UserType;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findServiceAccounts(transaction: RepositoryTransaction | undefined): Promise<BaseUser<string>[]> {
        const found: BaseUser<string>[][] = await Promise.all(this.userEntityRepositories
            .map(async repository => await repository.findAll({ where: { kind: 'service' }, unscoped: true, limit: 'all', transaction })));
        return found.flat().sort((a, b) => a.email.localeCompare(b.email));
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