import { Repository as TORepository, FindOptionsWhere, EntityManager, InsertResult } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { inject, ZIBRI_DI_TOKENS } from '../di';
import { NotFoundError } from '../error-handling';
import { LoggerInterface } from '../logging';
import { DeepPartial, Newable, OmitStrict } from '../types';
import { Transaction } from './transaction';
import { BaseEntity } from '../entity';
import { CreateAllOptions, CreateOptions, DeleteAllOptions, DeleteByIdOptions, FindAllOptions, FindAllPaginatedOptions, FindByIdOptions, FindOneOptions, UpdateAllOptions, UpdateByIdOptions, Where } from './models';
import { PaginationResult } from '../open-api';
import { whereFilterToFindOptionsWhere } from './models/where/where-filter-to-find-options-where.function';

export class Repository<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> {
    private readonly logger: LoggerInterface;
    private readonly typeOrmRepository: TORepository<T>;
    constructor(private readonly entityClass: Newable<T>, repo: TORepository<T> | Repository<T>) {
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

    async create(data: CreateData, options?: CreateOptions): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the create data, it will be ignored.');
            delete data.id;
        }
        const manager: EntityManager = this.getManager(options?.transaction);
        const res: InsertResult = await manager.insert(this.entityClass, data as QueryDeepPartialEntity<T>);
        // eslint-disable-next-line typescript/no-unsafe-argument
        return await this.findById(res.identifiers[0].id, options);
    }

    async createAll(data: CreateData[], options?: CreateAllOptions): Promise<T[]> {
        let entitiesWithIdCount: number = 0;
        for (const d of data) {
            if (d.id != undefined) {
                delete d.id;
                entitiesWithIdCount++;
            }
        }
        if (entitiesWithIdCount) {
            this.logger.warn(
                `Found an id on ${entitiesWithIdCount} out of ${data.length} entries of the create data. They will be ignored.`
            );
        }

        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.save(this.entityClass, data);
    }

    async findById(id: T['id'], options?: FindByIdOptions): Promise<T> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const res: T | null = await manager.findOneBy(this.entityClass, { id } as FindOptionsWhere<T>);
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return res;
    }

    async findOne(options: FindOneOptions<T>): Promise<T> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options.where);
        const res: T | null = await manager.findOne(this.entityClass, { ...options, where, transaction: undefined });
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityClass.name}.`);
        }
        return res;
    }

    async findAll(options?: FindAllOptions<T>): Promise<T[]> {
        const manager: EntityManager = this.getManager(options?.transaction);
        const where: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveFindOptionsWhere(options?.where);
        return await manager.find(this.entityClass, { ...options, where, transaction: undefined });
    }

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
            totalAmount: await manager.count(this.entityClass, { ...options, where, transaction: undefined })
        };
    }

    async updateById(id: T['id'], data: UpdateData, options?: UpdateByIdOptions): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        const manager: EntityManager = this.getManager(options?.transaction);
        const dataWithId: DeepPartial<T> = { id, ...data };
        return await manager.save(this.entityClass, dataWithId);
    }

    async updateAll(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions
    ): Promise<T[]> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        const toUpdate: DeepPartial<T>[] = (await this.findAll({ where, ...options })).map(t => ({ id: t.id, ...data }));

        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.save(this.entityClass, toUpdate);
    }

    async deleteById(id: T['id'], options?: DeleteByIdOptions): Promise<void> {
        const entityToDelete: T = await this.findById(id, options);
        const manager: EntityManager = this.getManager(options?.transaction);
        await manager.remove(this.entityClass, entityToDelete);
    }

    async deleteAll(
        where: Where<T>,
        options?: OmitStrict<DeleteAllOptions<T>, 'where'>
    ): Promise<T[]> {
        const toDelete: T[] = await this.findAll({ where, ...options });
        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.remove(this.entityClass, toDelete);
    }
}