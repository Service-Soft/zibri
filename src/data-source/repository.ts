import { Repository as TORepository, FindOptionsWhere, EntityManager, QueryFailedError as TOQueryFailedError, DeepPartial as ToDeepPartial } from 'typeorm';

import { BaseEntity } from '../entity/base-entity.model';
import { LoggerInterface } from '../logging/logger.interface';
import { PaginationResult } from '../open-api/pagination-result.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { DataSourceInterface } from './data-sources/data-source.interface';
import { BeforeReturnHook } from './hooks/before-return';
import { BeforeSaveHook } from './hooks/before-save';
import { CreateAllOptions } from './models/options/create-all-options.model';
import { CreateOptions } from './models/options/create-options.model';
import { DeleteAllOptions } from './models/options/delete-all-options.model';
import { DeleteByIdOptions } from './models/options/delete-by-id-options.model';
import { FindAllOptions } from './models/options/find-all-options.model';
import { FindAllPaginatedOptions } from './models/options/find-all-paginated-options.model';
import { FindByIdOptions } from './models/options/find-by-id-options.model';
import { FindOneOptions } from './models/options/find-one-options.model';
import { UpdateAllOptions } from './models/options/update-all-options.model';
import { UpdateByIdOptions } from './models/options/update-by-id-options.model';
import { whereFilterToFindOptionsWhere } from './models/where/where-filter-to-find-options-where.function';
import { Where } from './models/where/where-filter.model';
import { QueryFailedError } from './query-failed.error';
import { Transaction } from './transaction/transaction.model';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { ModelRegistry } from '../global/model-registry/model.registry';

/**
 * A repository that handles data source related things for its entity.
 */
export class Repository<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> {
    private readonly typeOrmRepository: TORepository<T>;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The data source that this repository is connected to.
     */
    get dataSource(): DataSourceInterface {
        return this._dataSource;
    }

    constructor(
        protected readonly entityClass: Newable<T>,
        repo: TORepository<T> | Repository<T>,
        protected readonly logger: LoggerInterface,
        private readonly _dataSource: DataSourceInterface,
        private readonly beforeSave: BeforeSaveHook<T, CreateData, UpdateData>,
        private readonly beforeReturn: BeforeReturnHook<T>
    ) {
        this.typeOrmRepository = repo instanceof Repository ? repo.typeOrmRepository : repo;
        ModelRegistry.get(this.entityClass);
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

    /**
     * Creates a new entity from the given data.
     * @param data - The create data.
     * @param options - Additional options, like a transaction etc.
     * @returns The newly created entity.
     */
    async create(data: CreateData, options?: CreateOptions): Promise<T> {
        if (data.id != undefined && options?.allowId != true) {
            await this.logger.warn('Found an id on the create data, it will be ignored.');
            delete data.id;
        }
        await this.beforeSave(data, true, this.entityClass);

        const manager: EntityManager = this.getManager(options?.transaction);
        try {
            const res: T = await manager.save(this.entityClass, data as ToDeepPartial<T>);
            await this.beforeReturn(res, this.entityClass);
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
    }

    /**
     * Creates all entities from the provided data array.
     * @param data - An array of create data, which each creates a new entity.
     * @param options - Additional options, eg. A transaction.
     * @returns All newly created entities.
     */
    async createAll(data: CreateData[], options?: CreateAllOptions): Promise<T[]> {
        const entitiesWithIdCount: number = (await Promise.all(
            data.map(async d => {
                let hadId: boolean = false;
                if (d.id != undefined && options?.allowId != true) {
                    delete d.id;
                    hadId = true;
                }
                await this.beforeSave(d, true, this.entityClass);
                return hadId;
            })
        )).filter(Boolean).length;
        if (entitiesWithIdCount) {
            await this.logger.warn(
                `Found an id on ${entitiesWithIdCount} out of ${data.length} entries of the create data. These ids will be ignored.`
            );
        }

        const manager: EntityManager = this.getManager(options?.transaction);
        try {
            const res: T[] = await manager.save(this.entityClass, data as ToDeepPartial<T>[]);
            await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass)));
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
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
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options.where);

        const manager: EntityManager = this.getManager(options?.transaction);
        let res: T | null;
        try {
            res = await manager.findOne(
                this.entityClass,
                { ...options, relations: options.relations as string[], where, transaction: undefined }
            );
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
        if (!res && required) {
            throw new NotFoundError(`Could not find ${this.entityClass.name}.`);
        }
        if (!res) {
            return undefined as B extends false ? T | undefined : T;
        }
        await this.beforeReturn(res, this.entityClass);
        return res;
    }

    /**
     * Finds all entities with the given options.
     * @param options - The options, including the where filter etc.
     * @returns An array of found entities.
     */
    async findAll(options?: FindAllOptions<T>): Promise<T[]> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options?.where);
        try {
            const res: T[] = await manager.find(
                this.entityClass,
                { ...options, where, relations: options?.relations as string[], transaction: undefined }
            );
            await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass)));
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
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
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options?.where);

        const manager: EntityManager = this.getManager(options?.transaction);

        try {
            return {
                items,
                totalAmount: await manager.count(this.entityClass, { ...options, where, relations: undefined, transaction: undefined })
            };
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
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
        data.id = id;
        await this.beforeSave(data, false, this.entityClass);

        try {
            const res: T = await manager.save(this.entityClass, data as ToDeepPartial<T>);
            await this.beforeReturn(res, this.entityClass);
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
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
        await this.beforeSave(data, false, this.entityClass);
        const toUpdate: DeepPartial<T>[] = (await this.findAll({ where, ...options })).map(t => ({ id: t.id, ...data }));

        const manager: EntityManager = this.getManager(options?.transaction);

        try {
            const res: T[] = await manager.save(this.entityClass, toUpdate as ToDeepPartial<T>[]);
            await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass)));
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
    }

    /**
     * Deletes an entity with the provided id.
     * @param id - The id of the entity to deleted.
     * @param options - Additional options, like a transaction.
     * @returns The deleted entity.
     */
    async deleteById(id: T['id'], options?: DeleteByIdOptions): Promise<T> {
        const entityToDelete: T = await this.findById(id, options);
        await this.beforeSave(entityToDelete, false, this.entityClass);
        const manager: EntityManager = this.getManager(options?.transaction);
        try {
            const res: T = await manager.remove(this.entityClass, entityToDelete);
            await this.beforeReturn(res, this.entityClass);
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
    }

    /**
     * Deletes all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be deleted.
     * @param options - Additional options, like a transaction.
     * @returns An array of all the deleted entities.
     */
    async deleteAll(
        where: Where<T>,
        options?: DeleteAllOptions<T>
    ): Promise<T[]> {
        const toDelete: T[] = await this.findAll({ where, ...options });
        await Promise.all(toDelete.map(r => this.beforeSave(r, false, this.entityClass)));

        const manager: EntityManager = this.getManager(options?.transaction);
        try {
            const res: T[] = await manager.remove(this.entityClass, toDelete);
            await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass)));
            return res;
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                throw new QueryFailedError(error as TOQueryFailedError);
            }
            throw error;
        }
    }
}