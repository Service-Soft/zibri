import { ChangeSetRepository } from './change-set-repository';
import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { DeleteAllOptions } from '../data-source/models/options/delete-all-options.model';
import { DeleteByIdOptions } from '../data-source/models/options/delete-by-id-options.model';
import { PaginationResult } from '../open-api/pagination-result.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { ChangeSetType } from './models/change-set-type.enum';
import { SoftDeleteCountOptions } from './models/soft-delete-count-options.model';
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
import { Repository, WrittenUpdate } from '../data-source/repository/repository';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { LoggerInterface } from '../logging/logger.interface';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { RepositoryDriverInterface } from '../data-source/driver/repository-driver.interface';
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
export type SoftDeleteAllOptions<T extends SoftDeleteEntity, R extends boolean = false> = DeleteAllOptions<T, R> & {
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
        repo: RepositoryDriverInterface<T> | Repository<T>,
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

    override async findAll(options?: SoftDeleteFindAllOptions<T>): Promise<T[]> {
        return await super.findAll({
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    override async findOne<B extends boolean = true>(
        options: SoftDeleteFindOneOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        return await super.findOne({
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    override async findById<B extends boolean = true>(
        id: T['id'],
        options?: SoftDeleteFindByIdOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        const found: T | undefined = await super.findById(id, { ...options, required: false });
        const res: T | undefined = found?.deleted === true && options?.withDeleted !== true ? undefined : found;
        if (!res && options?.required !== false) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return res as B extends false ? T | undefined : T;
    }

    override async count(options?: SoftDeleteCountOptions<T>): Promise<number> {
        return await super.count({
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    override async exists(options?: SoftDeleteCountOptions<T>): Promise<boolean> {
        return await super.exists({
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    override async findAllPaginated(
        page: number,
        limit: number,
        options?: SoftDeleteFindAllPaginatedOptions<T>
    ): Promise<PaginationResult<T>> {
        return await super.findAllPaginated(page, limit, {
            ...options,
            where: this.softDeleteWhereToWhere(options?.withDeleted, options?.where)
        });
    }

    override async updateAll<R extends boolean = false>(
        where: SoftDeleteWhere<T>,
        data: UpdateData,
        options?: SoftDeleteUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        return await super.updateAll(
            this.softDeleteWhereToWhere(options?.withDeleted, where),
            data,
            options
        );
    }

    override async updateById(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions<T>): Promise<T> {
        // no findById of its own: the one ChangeSetRepository does resolves to this class's override,
        // so the soft delete guard already applies to it
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

    protected override async saveUpdate(
        id: T['id'],
        data: UpdateData,
        options?: SoftDeleteUpdateByIdOptions<T>
    ): Promise<WrittenUpdate<T>> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteUpdateByIdOptions,
        // so without it `withDeleted` is not accepted here - and the read after a write that marks a
        // row deleted is the case that needs it
        return await super.saveUpdate(id, data, options);
    }

    override async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions<T>): Promise<T> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteUpdateByIdOptions,
        // so without it withDeleted is not accepted here. No findById of its own - the base reads
        // through this class's override, guard included.
        return await super.updateByIdWithoutChangeSet(id, data, options);
    }

    override async deleteById(id: T['id'], options?: SoftDeleteByIdOptions): Promise<T> {
        if (options?.hardDelete === true) {
            return await super.deleteById(id, options);
        }
        // one transaction over the read, the write that marks the row deleted and the change set
        // recording it. A hard delete takes none: it writes no change set, so there is nothing for
        // the write to be atomic with
        return await this.inTransaction(options, async transaction => {
            const inTransaction: SoftDeleteByIdOptions = { ...options, transaction };
            const entity: T = await this.findById(id, inTransaction);
            if (entity.deleted) {
                throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
            }
            // through saveUpdate rather than through updateById, which would read the row a second
            // time for a change set's before state - this already holds that row, and the change
            // set it would write is the one `deleted` is excluded from anyway. `withDeleted`
            // because the write is what makes the row invisible: the read after it is looking for a
            // row this call just marked deleted, and the guard would answer that it is gone
            const { entity: res }: WrittenUpdate<T> = await this.saveUpdate(
                id,
                { deleted: true } as UpdateData,
                { ...inTransaction, withDeleted: true }
            );
            await this.createChangeSet(entity, { deleted: true } as UpdateData, ChangeSetType.DELETE, inTransaction, true);
            return res;
        });
    }

    override async deleteAll<R extends boolean = false>(
        where: SoftDeleteWhere<T>,
        options?: SoftDeleteAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        if (options?.hardDelete === true) {
            // eslint-disable-next-line jsdoc/require-jsdoc
            const finalOptions: DeleteAllOptions<T, R> & { withDeleted?: boolean } = {
                ...options,
                withDeleted: true
            };
            return await super.deleteAll(this.softDeleteWhereToWhere(true, where), finalOptions);
        }

        return await this.inTransaction(options, async transaction => {
            const inTransaction: SoftDeleteAllOptions<T, R> = { ...options, transaction };
            // through saveUpdateAll rather than updateAllWithoutChangeSet: a soft delete is an
            // update, and its change sets are written from the entities it wrote, so they are read
            // whether or not the caller wants them back - which is exactly the distinction
            // saveUpdateAll draws
            const res: T[] = (await this.saveUpdateAll(
                this.softDeleteWhereToWhere(false, where),
                { deleted: true } as UpdateData,
                inTransaction
            )).map(u => u.entity);
            await this.createAllChangeSets(
                res,
                res.map(() => ({ deleted: true } as UpdateData)),
                ChangeSetType.DELETE,
                inTransaction,
                true
            );
            return (options?.returnDeleted === true ? res : res.length) as R extends true ? T[] : number;
        });
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