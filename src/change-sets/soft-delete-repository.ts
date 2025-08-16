import { Repository as TORepository } from 'typeorm';

import { DeepPartial, Newable } from '../types';
import { ChangeSetRepository } from './change-set-repository.model';
import { ChangeSetType, SoftDeleteEntity, SoftDeleteFindAllOptions, SoftDeleteFindAllPaginatedOptions, SoftDeleteFindByIdOptions, SoftDeleteFindOneOptions, SoftDeleteUpdateAllOptions, SoftDeleteUpdateByIdOptions, SoftDeleteWhere } from './models';
import { DeleteAllOptions, DeleteByIdOptions, Repository, Where } from '../data-source';
import { NotFoundError } from '../error-handling';
import { PaginationResult } from '../open-api';

/**
 * Options for deleting a soft delete entity by its id.
 */
export type SoftDeleteByIdOptions = DeleteByIdOptions & {
    /**
     * Whether or not to "actual" delete entities, rather than marking them as deleted.
     */
    hardDelete?: boolean
};

/**
 * Options for deleting multiple soft delete entities.
 */
export type SoftDeleteAllOptions<T extends SoftDeleteEntity> = DeleteAllOptions<T> & {
    /**
     * Whether or not to "actual" delete entities, rather than marking them as deleted.
     */
    hardDelete?: boolean
};

/**
 * A base crud repository that automatically handles creation of change sets and offers the option to "soft" delete entities
 * (Meaning they are flagged as deleted but still kept for restoration).
 */
export class SoftDeleteRepository<
    T extends SoftDeleteEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
>
    extends ChangeSetRepository<T, CreateData, UpdateData> {

    protected override readonly keysToExcludeFromChangeSets: (keyof T)[] = ['changeSets', 'deleted'];

    constructor(entityClass: Newable<T>, repo: TORepository<T> | Repository<T>) {
        super(entityClass, repo);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAll(options?: SoftDeleteFindAllOptions<T>): Promise<T[]> {
        return await super.findAll({
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne<B extends boolean = true>(
        options: SoftDeleteFindOneOptions<T>,
        required?: B
    ): Promise<B extends false ? T | undefined : T> {
        return await super.findOne(
            {
                ...options,
                where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
            },
            required
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findById(id: T['id'], options?: SoftDeleteFindByIdOptions<T>): Promise<T> {
        const res: T = await super.findById(id, options);
        if (options?.withDeleted === true) {
            return res;
        }
        if (res.deleted) {
            throw new NotFoundError(`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAllPaginated(
        page: number,
        limit: number,
        options?: SoftDeleteFindAllPaginatedOptions<T>
    ): Promise<PaginationResult<T>> {
        return await super.findAllPaginated(page, limit, {
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll(
        where: SoftDeleteWhere<T>,
        data: UpdateData,
        options?: SoftDeleteUpdateAllOptions
    ): Promise<T[]> {
        return await super.updateAll(
            this.softDeleteWhereToWhere(options?.withDeleted, where),
            data,
            options
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateById(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions): Promise<T> {
        await this.findById(id, options);
        return await super.updateById(id, data, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions): Promise<T> {
        await this.findById(id, options);
        return await super.updateByIdWithoutChangeSet(id, data, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteById(id: T['id'], options?: SoftDeleteByIdOptions): Promise<void> {
        if (options?.hardDelete === true) {
            await super.deleteById(id, options);
            return;
        }
        const entity: T = await this.findById(id, options);
        if (entity.deleted) {
            throw new NotFoundError(`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        await this.updateById(id, { deleted: true } as UpdateData, options);
        await this.createChangeSet(entity, { deleted: true } as UpdateData, ChangeSetType.DELETE, options, true);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteAll(where: SoftDeleteWhere<T>, options?: SoftDeleteAllOptions<T> | undefined): Promise<T[]> {
        if (options?.hardDelete === true) {
            return await super.deleteAll(this.softDeleteWhereToWhere(true, where), options);
        }
        const res: T[] = await this.updateAllWithoutChangeSet(
            this.softDeleteWhereToWhere(false, where),
            { deleted: true } as UpdateData,
            options
        );
        await this.createAllChangeSets(res, res.map(() => ({ deleted: true } as UpdateData)), ChangeSetType.DELETE, options, true);
        return res;
    }

    private softDeleteWhereToWhere(withDeleted: boolean = false, where?: SoftDeleteWhere<T>): Where<T> {
        if (where == undefined) {
            return { deleted: false } as Where<T>;
        }
        if (Array.isArray(where)) {
            return where.map(f => ({ ...f, deleted: withDeleted ? undefined : false }));
        }
        return { ...where, deleted: withDeleted ? undefined : false };
    }
}