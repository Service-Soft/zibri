import { Repository as TORepository } from 'typeorm';

import { ChangeSetRepository } from './change-set-repository';
import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { DeleteAllOptions } from '../data-source/models/options/delete-all-options.model';
import { DeleteByIdOptions } from '../data-source/models/options/delete-by-id-options.model';
import { PaginationResult } from '../open-api/pagination-result.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { ChangeSetType } from './models/change-set-type.enum';
import { SoftDeleteFindAllOptions } from './models/soft-delete-find-all-options.model';
import { SoftDeleteFindAllPaginatedOptions } from './models/soft-delete-find-all-paginated-options.model';
import { SoftDeleteFindByIdOptions } from './models/soft-delete-find-by-id-options.model';
import { SoftDeleteFindOneOptions } from './models/soft-delete-find-one-options.model';
import { SoftDeleteUpdateAllOptions } from './models/soft-delete-update-all-options.model';
import { SoftDeleteUpdateByIdOptions } from './models/soft-delete-update-by-id-options.model';
import { SoftDeleteWhere } from './models/soft-delete-where.model';
import { BeforeReturnHook } from '../data-source/hooks/before-return';
import { BeforeSaveHook } from '../data-source/hooks/before-save';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { LoggerInterface } from '../logging/logger.interface';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { $ts } from '../localization/translate.function';

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
export type SoftDeleteAllOptions = DeleteAllOptions & {
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

    constructor(
        entityClass: Newable<T>,
        repo: TORepository<T> | Repository<T>,
        logger: LoggerInterface,
        dataSource: DataSourceInterface,
        beforeSave: BeforeSaveHook<T, CreateData, UpdateData>,
        beforeReturn: BeforeReturnHook<T>,
        authService: AuthServiceInterface,
        changeSetRepository: Repository<ChangeSet, CreateChangeSetData>
    ) {
        super(entityClass, repo, logger, dataSource, beforeSave, beforeReturn, authService, changeSetRepository);
        this.keysToExcludeFromChangeSets.add('deleted');
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
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
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
        try {
            // The base updateById saves and then calls this.findById again.
            // If the update set deleted = true, that final findById will throw NotFoundError
            // because the soft‑delete guard now sees the entity as deleted.
            return await super.updateById(id, data, options);
        }
        catch (error) {
            // Only catch the case where the update itself caused the soft‑delete
            if (error instanceof NotFoundError && data.deleted === true) {
                return this.findById(id, { ...options, withDeleted: true });
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions): Promise<T> {
        await this.findById(id, options);
        return await super.updateByIdWithoutChangeSet(id, data, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteById(id: T['id'], options?: SoftDeleteByIdOptions): Promise<T> {
        if (options?.hardDelete === true) {
            return await super.deleteById(id, options);
        }
        const entity: T = await this.findById(id, options);
        if (entity.deleted) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        const res: T = await this.updateById(id, { deleted: true } as UpdateData, options);
        await this.createChangeSet(entity, { deleted: true } as UpdateData, ChangeSetType.DELETE, options, true);
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteAll(where: SoftDeleteWhere<T>, options?: SoftDeleteAllOptions | undefined): Promise<T[]> {
        if (options?.hardDelete === true) {
            // eslint-disable-next-line jsdoc/require-jsdoc
            const finalOptions: DeleteAllOptions & { withDeleted?: boolean } = {
                ...options,
                withDeleted: true
            };
            return await super.deleteAll(this.softDeleteWhereToWhere(true, where), finalOptions);
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
            return { deleted: withDeleted ? undefined : false } as Where<T>;
        }
        if (Array.isArray(where)) {
            return where.map(f => ({ ...f, deleted: withDeleted ? undefined : false }));
        }
        return { ...where, deleted: withDeleted ? undefined : false };
    }
}