import { Repository as TORepository, FindOptionsWhere, EntityManager } from 'typeorm';

import { inject, ZIBRI_DI_TOKENS } from '../di';
import { NotFoundError } from '../error-handling';
import { LoggerInterface } from '../logging';
import { DeepPartial, Newable } from '../types';
import { Transaction } from './transaction';
import { BaseEntity, PropertyMetadata } from '../entity';
import { CreateAllOptions, CreateOptions, DeleteAllOptions, DeleteByIdOptions, FindAllOptions, FindAllPaginatedOptions, FindByIdOptions, FindOneOptions, UpdateAllOptions, UpdateByIdOptions, Where } from './models';
import { PaginationResult } from '../open-api';
import { MetadataUtilities } from '../utilities';
import { whereFilterToFindOptionsWhere } from './models/where/where-filter-to-find-options-where.function';

/**
 * A repository that handles database related things for its entity.
 */
export class Repository<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly logger: LoggerInterface;
    private readonly typeOrmRepository: TORepository<T>;

    constructor(protected readonly entityClass: Newable<T>, repo: TORepository<T> | Repository<T>) {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
        this.typeOrmRepository = repo instanceof Repository ? repo.typeOrmRepository : repo;
    }

    private getManager(transaction: Transaction | undefined): EntityManager {
        return transaction ? transaction.queryRunner.manager : this.typeOrmRepository.manager;
    }

    private resolveFindOptionsWhere(where: Where<T> | undefined): FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined {
        if (!where) {
            return undefined;
        }
        return whereFilterToFindOptionsWhere(where, this.entityClass);
    }

    private async setDefaultValues(data: CreateData): Promise<void> {
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(this.entityClass);
        for (const key in props) {
            const property: PropertyMetadata = props[key];
            if (!('default' in property) || property.default == undefined) {
                continue;
            }

            if (
                typeof property.default === 'string'
                || typeof property.default === 'number'
                || typeof property.default === 'boolean'
                || property.default instanceof Date
            ) {
                data[key as keyof CreateData] = property.default as CreateData[keyof CreateData];
                continue;
            }
            data[key as keyof CreateData] = await property.default(data) as CreateData[keyof CreateData];
        }
    }

    /**
     * Creates a new entity from the given data.
     * Internally this uses insert.
     * @param data - The create data.
     * @param options - Additional options, like a transaction etc.
     * @returns The newly created entity.
     */
    async create(data: CreateData, options?: CreateOptions): Promise<T> {
        if (data.id != undefined && options?.allowId != true) {
            await this.logger.warn('Found an id on the create data, it will be ignored.');
            delete data.id;
        }
        await this.setDefaultValues(data);
        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.save(manager.create(this.entityClass, data));
    }

    /**
     * Creates all entities from the provided data array.
     * @param data - An array of create data, which each creates a new entity.
     * @param options - Additional options, eg. A transaction.
     * @returns All newly created entities.
     */
    async createAll(data: CreateData[], options?: CreateAllOptions): Promise<T[]> {
        let entitiesWithIdCount: number = 0;
        for (const d of data) {
            if (d.id != undefined && options?.allowId != true) {
                delete d.id;
                entitiesWithIdCount++;
            }
            await this.setDefaultValues(d);
        }
        if (entitiesWithIdCount) {
            await this.logger.warn(
                `Found an id on ${entitiesWithIdCount} out of ${data.length} entries of the create data. They will be ignored.`
            );
        }

        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.save(this.entityClass, data);
    }

    /**
     * Finds an entity by the given id.
     * @param id - The id of the entity to find.
     * @param options - Additional options, eg. Transaction.
     * @returns The found entity.
     */
    async findById(id: T['id'], options?: FindByIdOptions<T>): Promise<T> {
        const res: T | undefined = await this.findOne({ where: { id } as Where<T>, ...options }, false);
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return res;
    }

    /**
     * Finds a single entity with the given options.
     * @param options - The options, including the where filter etc.
     * @param required - Whether or not a result is required. Defaults to true.
     * @returns The found result. If required is set to false, also undefined.
     */
    async findOne<B extends boolean = true>(
        options: FindOneOptions<T>,
        required: B = true as B
    ): Promise<B extends false ? T | undefined : T> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options.where);
        const res: T | null = await manager.findOne(
            this.entityClass,
            { ...options, relations: options.relations as string[], where, transaction: undefined }
        );
        if (!res && required) {
            throw new NotFoundError(`Could not find ${this.entityClass.name}.`);
        }
        return (res ?? undefined) as B extends false ? T | undefined : T;
    }

    /**
     * Finds all entities with the given options.
     * @param options - The options, including the where filter etc.
     * @returns An array of found entities.
     */
    async findAll(options?: FindAllOptions<T>): Promise<T[]> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options?.where);
        return await manager.find(
            this.entityClass,
            { ...options, where, relations: options?.relations as string[], transaction: undefined }
        );
    }

    /**
     * Finds all entities with the given options, in paginated form.
     * @param page - The page for which the entities should be found.
     * @param limit - The limit of entities to receive for that page.
     * @param options - Additional options including where filter etc.
     * @returns A paginated result of the found entities.
     */
    async findAllPaginated(page: number, limit: number, options?: FindAllPaginatedOptions<T>): Promise<PaginationResult<T>> {
        const items: T[] = await this.findAll({
            skip: (page - 1) * limit,
            take: limit,
            ...options
        });
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options?.where);

        return {
            items,
            totalAmount: await manager.count(this.entityClass, { ...options, where, relations: undefined, transaction: undefined })
        };
    }

    /**
     * Updates an entity with the provided id.
     * @param id - The id of the entity to update.
     * @param data - The data to update the entity with.
     * @param options - Additional options, like a transaction.
     * @returns The updated entity.
     */
    async updateById(id: T['id'], data: UpdateData, options?: UpdateByIdOptions): Promise<T> {
        if (data.id != undefined && options?.allowId != true) {
            await this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        const manager: EntityManager = this.getManager(options?.transaction);
        const dataWithId: DeepPartial<T> = { id, ...data };
        return await manager.save(this.entityClass, dataWithId);
    }

    /**
     * Updates all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns An array of all the updated entities.
     */
    async updateAll(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions
    ): Promise<T[]> {
        if (data.id != undefined && options?.allowId != true) {
            await this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        const toUpdate: DeepPartial<T>[] = (await this.findAll({ where, ...options })).map(t => ({ id: t.id, ...data }));

        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.save(this.entityClass, toUpdate);
    }

    /**
     * Deletes an entity with the provided id.
     * @param id - The id of the entity to deleted.
     * @param options - Additional options, like a transaction.
     */
    async deleteById(id: T['id'], options?: DeleteByIdOptions): Promise<void> {
        const entityToDelete: T = await this.findById(id, options);
        const manager: EntityManager = this.getManager(options?.transaction);
        await manager.remove(this.entityClass, entityToDelete);
    }

    /**
     * Deletes all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be deleted.
     * @param options - Additional options, like a transaction.
     * @returns An array of all the updated entities.
     */
    async deleteAll(
        where: Where<T>,
        options?: DeleteAllOptions<T>
    ): Promise<T[]> {
        const toDelete: T[] = await this.findAll({ where, ...options });
        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.remove(this.entityClass, toDelete);
    }
}