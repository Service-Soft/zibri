import { Repository } from './repository';
import { RepositoryClass } from './repository-class.type';
import { REPOSITORY_KINDS } from './repository-kind.model';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { inject } from '../../di/inject.function';
import { DiVariant } from '../../di/models/di-variant.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ChangeSetRepository } from '../change-sets/change-set-repository';
import { ChangeSetEntity } from '../change-sets/models/change-set-entity.model';
import { ChangeSet } from '../change-sets/models/change-set.model';
import { isChangeSetEntityNewable } from '../change-sets/models/is-change-set-entity.function';
import { isSoftDeleteEntityNewable } from '../change-sets/models/is-soft-delete-entity.function';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../change-sets/soft-delete-repository';
import { DataSourceInterface, RepositoryTypeForEntity } from '../data-sources/data-source.interface';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { RegisteredDataSource } from '../entity-ownership.function';

/**
 * Utilities for the repository classes a data source lists, each declared with `@RepositoryFor`.
 */
export abstract class RepositoryForUtilities {
    /**
     * Finds the repository class a data source lists for one of its entities.
     * @param dataSource - The data source.
     * @param entity - The entity.
     * @returns The class, undefined when the data source lists none for the entity.
     */
    static findRepositoryClass(dataSource: DataSourceInterface, entity: Newable<BaseEntity>): RepositoryClass | undefined {
        return dataSource.repositories.find(r => MetadataUtilities.getRepositoryForMetadata(r)?.entity === entity);
    }

    /**
     * Resolves the repository of an entity a data source declares, building it the first time: a soft
     * delete or change set repository for such an entity, a plain one otherwise, each over a driver of
     * the data source, and the class the data source lists for the entity over that.
     * @param dataSource - The data source.
     * @param entity - The entity.
     * @param built - The repositories the data source has built so far, which a new one is added to.
     * @param logger - The logger of the data source.
     * @param authService - The auth service the change sets name their users with.
     * @param createDriver - Creates a driver of the data source for the entity.
     * @returns The repository.
     * @throws When the data source does not declare the entity.
     */
    static resolveEntityRepository<T extends BaseEntity>(
        dataSource: DataSourceInterface,
        entity: Newable<T>,
        built: Map<Newable<BaseEntity>, Repository<BaseEntity>>,
        logger: LoggerInterface,
        authService: AuthServiceInterface,
        createDriver: () => RepositoryDriverInterface<T>
    ): RepositoryTypeForEntity<T> {
        if (!dataSource.entities.includes(entity)) {
            throw new InternalError([
                `The entity "${entity.name}" is not in this database.`,
                'Did you forget to include it in the entities array?'
            ]);
        }
        const existing: Repository<BaseEntity> | undefined = built.get(entity);
        if (existing) {
            return existing as RepositoryTypeForEntity<T>;
        }
        const driver: RepositoryDriverInterface<T> = createDriver();
        // the guards narrow the class and not T, which the repository is typed in
        const repository: RepositoryTypeForEntity<T> = isSoftDeleteEntityNewable(entity)
            ? new SoftDeleteRepository(
                entity,
                driver as unknown as RepositoryDriverInterface<SoftDeleteEntity>,
                logger,
                dataSource,
                authService,
                dataSource.getRepository(ChangeSet)
            ) as RepositoryTypeForEntity<T>
            : isChangeSetEntityNewable(entity)
                ? new ChangeSetRepository(
                    entity,
                    driver as unknown as RepositoryDriverInterface<ChangeSetEntity>,
                    logger,
                    dataSource,
                    authService,
                    dataSource.getRepository(ChangeSet)
                ) as RepositoryTypeForEntity<T>
                : new Repository<T>(entity, driver, logger, dataSource) as RepositoryTypeForEntity<T>;
        // the class listed for the entity rather than the repository it is built over, so that what it
        // overrides holds for every row of the entity, those written through a relation included
        const resolved: Repository<BaseEntity> = this.resolveRepository(dataSource, entity, repository as Repository<BaseEntity>);
        built.set(entity, resolved);
        return resolved as RepositoryTypeForEntity<T>;
    }

    /**
     * Resolves the repository an entity is read and written through: the class the data source lists
     * for it, built over the repository the data source builds, or that repository when it lists none.
     * @param dataSource - The data source.
     * @param entity - The entity.
     * @param repository - The repository the data source builds for the entity.
     * @returns The repository.
     */
    static resolveRepository(
        dataSource: DataSourceInterface,
        entity: Newable<BaseEntity>,
        repository: Repository<BaseEntity>
    ): Repository<BaseEntity> {
        const repositoryClass: RepositoryClass | undefined = this.findRepositoryClass(dataSource, entity);
        return repositoryClass == undefined ? repository : this.buildRepository(repositoryClass, entity, repository);
    }

    /**
     * Builds the repository class of an entity over the repository its data source builds for it.
     * @param repositoryClass - The class.
     * @param entity - The entity.
     * @param repository - The repository the data source builds for the entity.
     * @returns The repository.
     * @throws When the class builds something that is no repository.
     */
    static buildRepository(
        repositoryClass: RepositoryClass,
        entity: Newable<BaseEntity>,
        repository: Repository<BaseEntity>
    ): Repository<BaseEntity> {
        const built: object = new repositoryClass(entity, repository);
        if (!(built instanceof Repository)) {
            throw new InternalError(
                `${repositoryClass.name} is declared with @RepositoryFor(${entity.name}), but does not extend Repository.`
            );
        }
        return built as Repository<BaseEntity>;
    }

    /**
     * Resolves what the framework finds a repository class by, from the mark its prototype carries.
     * @param repositoryClass - The class.
     * @returns The variants, none for a repository that is nothing besides one.
     */
    static resolveVariants(repositoryClass: RepositoryClass): DiVariant[] {
        return REPOSITORY_KINDS.filter(kind => kind.repositoryMark in repositoryClass.prototype).map(kind => kind.variant);
    }

    /**
     * Refuses repository classes that cannot be built or are listed where they do not belong, before
     * any data source is initialized.
     * @param dataSources - Every data source of the application.
     * @throws When a class is listed that cannot be the repository of its entity there, or a class
     * of an entity the application stores is listed by none of them.
     */
    static validateListed(dataSources: RegisteredDataSource[]): void {
        const listedBy: Map<RepositoryClass, string[]> = new Map();
        for (const { dataSourceClass, dataSource } of dataSources) {
            for (const repositoryClass of dataSource.repositories) {
                listedBy.set(repositoryClass, [...listedBy.get(repositoryClass) ?? [], dataSourceClass.name]);
                this.validateRepositoryClass(dataSourceClass.name, dataSource, repositoryClass);
            }
            this.validateOnePerEntity(dataSourceClass.name, dataSource);
            this.validateMarkedEntitiesHaveRepositories(dataSourceClass.name, dataSource);
        }

        for (const [repositoryClass, names] of listedBy) {
            if (names.length > 1) {
                throw new InternalError([
                    `${repositoryClass.name} is listed in the repositories of ${names.join(' and ')}.`,
                    'A repository class belongs to one data source. Declare a class for each of them.'
                ]);
            }
        }

        // a class declared for an entity the application stores, which no data source lists, would
        // leave the entity read and written past it without a word
        const stored: Set<Newable<BaseEntity>> = new Set(dataSources.flatMap(({ dataSource }) => dataSource.entities));
        for (const repositoryClass of GlobalRegistry.repositoryClasses) {
            const entity: Newable<BaseEntity> | undefined = MetadataUtilities.getRepositoryForMetadata(repositoryClass)?.entity;
            if (
                entity != undefined
                && stored.has(entity)
                && !dataSources.some(({ dataSource }) => dataSource.repositories.some(r => r === repositoryClass))
            ) {
                throw new InternalError([
                    // eslint-disable-next-line stylistic/max-len
                    `${repositoryClass.name} is declared with @RepositoryFor(${entity.name}), but no data source lists it in its repositories.`,
                    `Add it to the repositories of the data source that declares ${entity.name}.`
                ]);
            }
        }
    }

    /**
     * Builds every listed repository class once its data source is initialized, so that one that
     * cannot be built over the repository of its entity refuses to start rather than fails its
     * first read.
     * @param dataSources - Every data source of the application.
     * @throws When a class cannot be built, or carries its mark somewhere other than its prototype.
     */
    static validateBuilt(dataSources: RegisteredDataSource[]): void {
        for (const { dataSource } of dataSources) {
            for (const repositoryClass of dataSource.repositories) {
                const repository: object = inject(repositoryClass);
                for (const kind of REPOSITORY_KINDS) {
                    // the mark is read off the prototype while the providers are registered, which is
                    // before any data source can build a repository
                    if (kind.repositoryMark in repository && !(kind.repositoryMark in repositoryClass.prototype)) {
                        throw new InternalError([
                            `${repositoryClass.name} carries the mark of a ${kind.name} repository on its instances.`,
                            `Declare it as a getter, as the shipped bases do, or extend ${kind.base}().`
                        ]);
                    }
                }
            }
        }
    }

    /**
     * Refuses a listed class that is not a repository of an entity of the data source, that the
     * framework cannot build, or whose mark does not match the mark of its entity.
     * @param dataSourceName - The name of the data source, for the messages.
     * @param dataSource - The data source listing it.
     * @param repositoryClass - The listed class.
     * @throws When the class cannot be the repository of its entity in this data source.
     */
    private static validateRepositoryClass(
        dataSourceName: string,
        dataSource: DataSourceInterface,
        repositoryClass: RepositoryClass
    ): void {
        const entity: Newable<BaseEntity> | undefined = MetadataUtilities.getRepositoryForMetadata(repositoryClass)?.entity;
        if (entity == undefined) {
            throw new InternalError(
                `${repositoryClass.name} is listed in the repositories of ${dataSourceName}, but is not declared with @RepositoryFor.`
            );
        }
        if (!(repositoryClass.prototype instanceof Repository)) {
            throw new InternalError(
                `${repositoryClass.name} is declared with @RepositoryFor(${entity.name}), but does not extend Repository.`
            );
        }
        // a class without a constructor of its own takes the one it inherits, which takes no parameter
        // it names itself. The framework builds it with the entity and the repository underneath
        if (repositoryClass.length !== 0) {
            throw new InternalError([
                `${repositoryClass.name} declares a constructor of its own.`,
                'The framework builds a repository class over the repository of its entity: remove the constructor,',
                'and reach anything else it needs through inject().'
            ]);
        }
        if (!dataSource.entities.includes(entity)) {
            throw new InternalError([
                `${repositoryClass.name} is the repository of ${entity.name}, which ${dataSourceName} does not declare.`,
                `List it in the repositories of the data source that declares ${entity.name}.`
            ]);
        }
        for (const kind of REPOSITORY_KINDS) {
            if (kind.repositoryMark in repositoryClass.prototype && !(kind.entityMark in entity)) {
                throw new InternalError([
                    `${repositoryClass.name} is a ${kind.name} repository, but ${entity.name} is no ${kind.name} entity.`,
                    `A ${kind.name} repository is the repository of an entity extending ${kind.entityBase}.`
                ]);
            }
        }
    }

    /**
     * Refuses two repository classes for one entity in one data source.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source.
     * @throws When the data source lists two classes for the same entity.
     */
    private static validateOnePerEntity(dataSourceName: string, dataSource: DataSourceInterface): void {
        for (const entity of dataSource.entities) {
            const classes: RepositoryClass[] = dataSource.repositories
                .filter(r => MetadataUtilities.getRepositoryForMetadata(r)?.entity === entity);
            if (classes.length > 1) {
                throw new InternalError([
                    `${dataSourceName} lists several repositories of ${entity.name}: ${classes.map(c => c.name).join(', ')}.`,
                    'An entity has one repository in a data source. Keep one of them.'
                ]);
            }
        }
    }

    /**
     * Refuses an entity carrying the mark of users, memberships or roles whose data source lists no
     * repository carrying the same mark for it, since the framework reads such rows through it.
     * @param dataSourceName - The name of the data source, for the message.
     * @param dataSource - The data source.
     * @throws When a marked entity has no marked repository.
     */
    private static validateMarkedEntitiesHaveRepositories(dataSourceName: string, dataSource: DataSourceInterface): void {
        for (const entity of dataSource.entities) {
            for (const kind of REPOSITORY_KINDS) {
                if (!(kind.entityMark in entity)) {
                    continue;
                }
                const repositoryClass: RepositoryClass | undefined = this.findRepositoryClass(dataSource, entity);
                if (repositoryClass == undefined || !(kind.repositoryMark in repositoryClass.prototype)) {
                    throw new InternalError([
                        `${entity.name} is a ${kind.name} entity, but ${dataSourceName} lists no ${kind.name} repository for it.`,
                        `Declare one with @RepositoryFor(${entity.name}) extending ${kind.base}<${entity.name}>(), `
                        + 'and list it in the repositories of the data source.',
                        `A ${kind.name} repository of your own declares its mark as a getter, which its prototype carries.`
                    ]);
                }
            }
        }
    }
}