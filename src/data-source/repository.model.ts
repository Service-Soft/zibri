import { Repository as TORepository, FindOptionsWhere, EntityManager, InsertResult } from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { inject, ZIBRI_DI_TOKENS } from '../di';
import { NotFoundError } from '../error-handling';
import { LoggerInterface } from '../logging';
import { DeepPartial, Newable } from '../types';
import { Transaction } from './transaction';
import { BaseEntity } from '../entity';
import { CreateAllOptions, CreateOptions, DeleteAllOptions, DeleteByIdOptions, FindAllOptions, FindByIdOptions, FindOneOptions, UpdateAllOptions, UpdateByIdOptions } from './models';

export class Repository<T extends BaseEntity> {
    private readonly logger: LoggerInterface;
    constructor(private readonly entityClass: Newable<T>, private readonly typeOrmRepository: TORepository<T>) {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private getManager(transaction: Transaction | undefined): EntityManager {
        return transaction ? transaction.queryRunner.manager : this.typeOrmRepository.manager;
    }

    async create(data: DeepPartial<T>, options?: CreateOptions): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the create data, it will be ignored.');
            delete data.id;
        }
        const manager: EntityManager = this.getManager(options?.transaction);
        const res: InsertResult = await manager.insert(this.entityClass, data as QueryDeepPartialEntity<T>);
        // eslint-disable-next-line typescript/no-unsafe-argument
        return await this.findById(res.identifiers[0].id, options);
    }

    async createAll(data: DeepPartial<T>[], options?: CreateAllOptions): Promise<T[]> {
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
        const res: T | null = await manager.findOne(this.entityClass, options);
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityClass.name}.`);
        }
        return res;
    }

    async findAll(options?: FindAllOptions<T>): Promise<T[]> {
        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.find(this.entityClass, { ...options, transaction: undefined });
    }

    async updateById(id: T['id'], data: DeepPartial<T>, options?: UpdateByIdOptions): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        const manager: EntityManager = this.getManager(options?.transaction);
        const dataWithId: DeepPartial<T> = { id, ...data };
        return await manager.save(this.entityClass, dataWithId);
    }

    async updateAll(
        where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
        data: DeepPartial<T>,
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
        where: FindOptionsWhere<T> | FindOptionsWhere<T>[],
        options?: DeleteAllOptions<T>
    ): Promise<T[]> {
        const toDelete: T[] = await this.findAll({ where, ...options });
        const manager: EntityManager = this.getManager(options?.transaction);
        return await manager.remove(this.entityClass, toDelete);
    }
}