import { Repository as TORepository, FindManyOptions, FindOneOptions, FindOptionsWhere } from 'typeorm';

import { inject, ZIBRI_DI_TOKENS } from '../di';
import { NotFoundError } from '../error-handling';
import { LoggerInterface } from '../logging';
import { DeepPartial } from '../types';

export type BaseEntity = { id: string | number };

export class Repository<T extends BaseEntity> {
    private readonly logger: LoggerInterface;
    constructor(private readonly entityName: string, private readonly typeOrmRepository: TORepository<T>) {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async create(data: DeepPartial<T>): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the create data, it will be ignored.');
            delete data.id;
        }
        return await this.typeOrmRepository.save(data);
    }

    async findById(id: T['id']): Promise<T> {
        const res: T | null = await this.typeOrmRepository.findOneBy({ id } as FindOptionsWhere<T>);
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityName} with id "${id}".`);
        }
        return res;
    }

    async findAll(options?: FindManyOptions<T>): Promise<T[]> {
        return this.typeOrmRepository.find(options);
    }

    async findOne(options: FindOneOptions<T>): Promise<T> {
        const res: T | null = await this.typeOrmRepository.findOne(options);
        if (!res) {
            throw new NotFoundError(`Could not find ${this.entityName}.`);
        }
        return res;
    }

    async updateById(id: T['id'], data: DeepPartial<T>): Promise<T> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete data.id;
        }
        await this.findById(id);
        const dataWithId: DeepPartial<T> = { ...data, id: id };
        return await this.typeOrmRepository.save(dataWithId);
    }

    async deleteById(id: T['id']): Promise<void> {
        const entityToDelete: T = await this.findById(id);
        await this.typeOrmRepository.remove(entityToDelete);
    }
}