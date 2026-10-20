import { ChangeSetRepository } from './change-set-repository.ts';
import { isSoftDeleteEntityNewable } from './models/is-soft-delete-entity.function.ts';
import { SoftDeleteEntity } from './models/soft-delete-entity.model.ts';
import { BaseRepositoryOptions } from '../data-source/models/options/base-repository-options.model.ts';
import { DeleteAllOptions } from '../data-source/models/options/delete-all-options.model.ts';
import { DeleteByIdOptions } from '../data-source/models/options/delete-by-id-options.model.ts';
import { PaginationResult } from '../open-api/pagination-result.model.ts';
import { DeepPartial } from '../types/deep-partial.type.ts';
import { Newable } from '../types/newable.type.ts';
import { ChangeSetType } from './models/change-set-type.enum.ts';
import { SoftDeleteCountOptions } from './models/soft-delete-count-options.model.ts';
import { SoftDeleteFindAllOptions } from './models/soft-delete-find-all-options.model.ts';
import { SoftDeleteFindAllPaginatedOptions } from './models/soft-delete-find-all-paginated-options.model.ts';
import { SoftDeleteFindByIdOptions } from './models/soft-delete-find-by-id-options.model.ts';
import { SoftDeleteFindOneOptions } from './models/soft-delete-find-one-options.model.ts';
import { SoftDeleteUpdateAllOptions } from './models/soft-delete-update-all-options.model.ts';
import { SoftDeleteUpdateByIdOptions } from './models/soft-delete-update-by-id-options.model.ts';
import { SoftDeleteWhere, SoftDeleteWhereFilter } from './models/soft-delete-where.model.ts';
import { SoftDeletedRows } from './models/soft-deleted-rows.type.ts';
import { BeforeReturnHook } from '../data-source/hooks/before-return.ts';
import { BeforeSaveHook } from '../data-source/hooks/before-save.ts';
import { Where, WhereFilter } from '../data-source/models/where/where-filter.model.ts';
import { Repository, WrittenUpdate } from '../data-source/repository/repository.ts';
import { NotFoundError } from '../error-handling/errors/not-found.error.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { LoggerInterface } from '../logging/logger.interface.ts';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model.ts';
import { AuthServiceInterface } from '../auth/auth-service.interface.ts';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface.ts';
import { RepositoryDriverInterface } from '../data-source/driver/repository-driver.interface.ts';
import { OwnedRelationUtilities } from '../data-source/owned-relation.utilities.ts';
import { Transaction } from '../data-source/transaction/transaction.model.ts';
import { $ts } from '../localization/translate.function.ts';

/**
 * The value each choice of soft deleted rows gives `deleted` in a filter. Undefined is a filter with
 * nothing to say about it.
 */
const DELETED_FILTER_VALUES: Record<SoftDeletedRows, boolean | undefined> = {
    exclude: false,
    include: undefined,
    only: true
};

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
        this.keysToExcludeFromChangeSets.add('deletedWith');
    }

    override async findAll(options?: SoftDeleteFindAllOptions<T>): Promise<T[]> {
        return await super.findAll({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findOne<B extends boolean = true>(
        options: SoftDeleteFindOneOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        return await super.findOne({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findById<B extends boolean = true>(
        id: T['id'],
        options?: SoftDeleteFindByIdOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteFindByIdOptions.
        // The guard is the findOne the base reads through, which resolves to this class's override
        // and is handed `deleted` along with everything else
        return await super.findById(id, options);
    }

    override async count(options?: SoftDeleteCountOptions<T>): Promise<number> {
        return await super.count({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async exists(options?: SoftDeleteCountOptions<T>): Promise<boolean> {
        return await super.exists({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findAllPaginated(
        page: number,
        limit: number,
        options?: SoftDeleteFindAllPaginatedOptions<T>
    ): Promise<PaginationResult<T>> {
        return await super.findAllPaginated(page, limit, {
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async updateAll<R extends boolean = false>(
        where: SoftDeleteWhere<T>,
        data: UpdateData,
        options?: SoftDeleteUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        return await this.withinTimeout(options, 'updateAll', async () => {
            if (data.deleted !== false) {
                return await super.updateAll(
                    this.softDeleteWhereToWhere(options?.deleted, where),
                    data,
                    options
                );
            }
            // a restore, which restores the rows deleted along with these - so it needs to know which
            // rows it restored, whether or not the caller asked for them
            return await this.inTransaction(options, async transaction => {
                const restored: T[] = await super.updateAll(
                    this.softDeleteWhereToWhere(options?.deleted, where),
                    // eslint-disable-next-line unicorn/no-null
                    { ...data, deletedWith: null },
                    { ...options, transaction, returnUpdated: true }
                );
                await this.restoreOwnedRows(restored.map(r => r.id), transaction);
                return (options?.returnUpdated === true ? restored : restored.length) as R extends true ? T[] : number;
            });
        });
    }

    override async updateById(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions<T>): Promise<T> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteUpdateByIdOptions.
        // No findById of its own - the one ChangeSetRepository does resolves to this class's override,
        // so the soft delete guard already applies to it
        return await super.updateById(id, data, options);
    }

    protected override async saveUpdate(
        id: T['id'],
        data: UpdateData,
        options?: SoftDeleteUpdateByIdOptions<T>
    ): Promise<WrittenUpdate<T>> {
        // every row, whatever the caller asked for: the guard was applied before the write, by
        // whichever read decided the row is there, and the reads after it are about the row this call
        // just wrote. A write that marks it deleted - or restores it under `only` - is what would
        // otherwise hide it from them. This used to be a caught NotFoundError in updateById, which
        // only ran after the transaction had rolled the write back, and which also answered a row
        // that was already deleted as a successful update that wrote nothing
        const everyRow: SoftDeleteUpdateByIdOptions<T> = { ...options, deleted: 'include' };
        if (data.deleted !== false) {
            return await super.saveUpdate(id, data, everyRow);
        }
        // a restore, which restores the rows deleted along with this one
        return await this.inTransaction(options, async transaction => {
            // eslint-disable-next-line unicorn/no-null
            const res: WrittenUpdate<T> = await super.saveUpdate(id, { ...data, deletedWith: null }, { ...everyRow, transaction });
            await this.restoreOwnedRows([id], transaction);
            return res;
        });
    }

    protected override async updateEach(
        rows: UpdateData[],
        options?: BaseRepositoryOptions & Pick<SoftDeleteUpdateByIdOptions<T>, 'deleted'>,
        where?: SoftDeleteWhere<T>
    ): Promise<WrittenUpdate<T>[]> {
        const restoredIds: Set<string> = new Set(rows.filter(r => r.deleted === false).map(r => String(r.id)));
        if (!restoredIds.size) {
            return await super.updateEach(rows, options, this.softDeleteWhereToWhere(options?.deleted, where));
        }
        // what saveUpdate does for a restore of one row: the rows deleted along with these are
        // restored with them, in the same transaction
        return await this.inTransaction(options, async transaction => {
            const updates: WrittenUpdate<T>[] = await super.updateEach(
                // eslint-disable-next-line unicorn/no-null
                rows.map(r => restoredIds.has(String(r.id)) ? { ...r, deletedWith: null } : r),
                { ...options, transaction },
                this.softDeleteWhereToWhere(options?.deleted, where)
            );
            await this.restoreOwnedRows(
                updates.filter(u => restoredIds.has(String(u.entity.id))).map(u => u.entity.id),
                transaction
            );
            return updates;
        });
    }

    override async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions<T>): Promise<T> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteUpdateByIdOptions,
        // so without it `deleted` is not accepted here. No findById of its own - the base reads
        // through this class's override, guard included.
        return await super.updateByIdWithoutChangeSet(id, data, options);
    }

    override async deleteById(id: T['id'], options?: SoftDeleteByIdOptions): Promise<T> {
        return await this.withinTimeout(options, 'deleteById', async () => {
            if (options?.hardDelete === true) {
                // every row, the way a hard deleteAll reaches every row: removing a soft deleted one
                // is how it goes for good, and the guard answered that it was not there
                const everyRow: SoftDeleteByIdOptions & Pick<SoftDeleteFindByIdOptions<T>, 'deleted'> = { ...options, deleted: 'include' };
                return await super.deleteById(id, everyRow);
            }
            // one transaction over the read, the write that marks the row deleted and the change set
            // recording it. A hard delete takes none: it writes no change set, so there is nothing
            // for the write to be atomic with
            return await this.inTransaction(options, async transaction => {
                const inTransaction: SoftDeleteByIdOptions = { ...options, transaction };
                const entity: T = await this.findById(id, inTransaction);
                if (entity.deleted) {
                    throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
                }
                // through saveUpdate rather than through updateById, which would read the row a
                // second time for a change set's before state - this already holds that row, and the
                // change set it would write is the one `deleted` is excluded from anyway
                const { entity: res }: WrittenUpdate<T> = await this.saveUpdate(id, { deleted: true } as UpdateData, inTransaction);
                await this.createChangeSet(entity, { deleted: true } as UpdateData, ChangeSetType.DELETE, inTransaction, true);
                await this.softDeleteOwnedRows([id], transaction);
                return res;
            });
        });
    }

    override async deleteAll<R extends boolean = false>(
        where: SoftDeleteWhere<T>,
        options?: SoftDeleteAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        return await this.withinTimeout(options, 'deleteAll', async () => {
            if (options?.hardDelete === true) {
                const everyRow: DeleteAllOptions<T, R> & Pick<SoftDeleteFindAllOptions<T>, 'deleted'> = { ...options, deleted: 'include' };
                return await super.deleteAll(this.softDeleteWhereToWhere('include', where), everyRow);
            }

            return await this.inTransaction(options, async transaction => {
                // eslint-disable-next-line unicorn/no-null
                const res: T[] = await this.markDeleted(where, null, { ...options, transaction });
                return (options?.returnDeleted === true ? res : res.length) as R extends true ? T[] : number;
            });
        });
    }

    /**
     * Marks the rows matching a filter deleted, records it, and does the same to the rows of their
     * relations that are removed along with them.
     * @param where - The filter naming the rows.
     * @param deletedWith - The id of the row whose delete takes these along, null when they are
     * deleted on their own.
     * @param options - The options of the delete, holding the transaction it runs in.
     * @returns The rows it marked.
     */
    private async markDeleted(
        where: SoftDeleteWhere<T>,
        deletedWith: string | null,
        options: SoftDeleteAllOptions<T, boolean> & Pick<Required<SoftDeleteAllOptions<T, boolean>>, 'transaction'>
    ): Promise<T[]> {
        // through saveUpdateAll rather than updateAllWithoutChangeSet: a soft delete is an update,
        // and its change sets are written from the entities it wrote, so they are read whether or not
        // the caller wants them back - which is exactly the distinction saveUpdateAll draws
        const res: T[] = (await this.saveUpdateAll(
            this.softDeleteWhereToWhere('exclude', where),
            { deleted: true, deletedWith } as UpdateData,
            options
        )).map(u => u.entity);
        await this.createAllChangeSets(
            res,
            res.map(() => ({ deleted: true } as UpdateData)),
            ChangeSetType.DELETE,
            options,
            true
        );
        await this.softDeleteOwnedRows(res.map(r => r.id), options.transaction);
        return res;
    }

    /**
     * Soft deletes the rows of the relations removed along with the given rows, noting which row took
     * each along - so restoring that row restores them, and not rows deleted on their own before.
     *
     * Every row of them, whoever may see it, as a hard delete takes every row. One owner at a time,
     * because each row notes its own owner.
     * @param ownerIds - The ids of the rows just marked deleted.
     * @param transaction - The transaction the delete runs in.
     */
    private async softDeleteOwnedRows(ownerIds: string[], transaction: Transaction): Promise<void> {
        for (const relation of OwnedRelationUtilities.resolveAll(this.entityClass)) {
            // one that does not soft delete is refused when the application starts
            if (!relation.cascadesRemove || !isSoftDeleteEntityNewable(relation.target)) {
                continue;
            }
            const repository: SoftDeleteRepository<SoftDeleteEntity> = this.dataSource.getRepository(relation.target);
            for (const ownerId of ownerIds) {
                await repository.markDeleted(
                    { [relation.foreignKey]: ownerId },
                    ownerId,
                    { transaction, unscoped: true, acrossTenants: true }
                );
            }
        }
    }

    /**
     * Restores the rows that were soft deleted along with the given rows, which restores theirs in
     * turn.
     * @param ownerIds - The ids of the rows just restored.
     * @param transaction - The transaction the restore runs in.
     */
    private async restoreOwnedRows(ownerIds: string[], transaction: Transaction): Promise<void> {
        for (const relation of OwnedRelationUtilities.resolveAll(this.entityClass)) {
            if (!relation.cascadesRemove || !isSoftDeleteEntityNewable(relation.target)) {
                continue;
            }
            await this.dataSource.getRepository(relation.target).updateAll(
                { deletedWith: { oneOf: ownerIds } },
                { deleted: false },
                { transaction, deleted: 'only', unscoped: true, acrossTenants: true }
            );
        }
    }

    /**
     * The caller's filter, with the condition on `deleted` that the soft deleted rows asked for put
     * on every branch of it.
     * @param rows - Which soft deleted rows the call reaches.
     * @param where - The filter the caller gave.
     * @returns The filter to hand to the repository underneath.
     * @throws When a branch names `deleted` with a value other than the one `rows` puts there.
     */
    private softDeleteWhereToWhere(rows: SoftDeletedRows = 'exclude', where?: SoftDeleteWhere<T>): Where<T> {
        const deleted: boolean | undefined = DELETED_FILTER_VALUES[rows];
        if (where == undefined) {
            return { deleted } as Where<T>;
        }
        if (Array.isArray(where)) {
            return where.map(f => this.withDeletedCondition(f, deleted));
        }
        return this.withDeletedCondition(where, deleted);
    }

    /**
     * One branch of a filter, with the condition on `deleted` put on it.
     * @param branch - The branch the caller wrote.
     * @param deleted - The value the condition gives `deleted`. Undefined is no condition at all.
     * @returns The branch with that condition.
     * @throws When the branch names `deleted` with a different value.
     */
    private withDeletedCondition(branch: SoftDeleteWhereFilter<T>, deleted: boolean | undefined): WhereFilter<T> {
        // the type leaves `deleted` out, and a filter typed as the entity's plain Where still carries
        // one. Overwriting it answered something other than what was asked, without a word. Agreeing
        // is let through rather than refused, because that is also what this class hands itself: a
        // bulk update converts the filter and the reads underneath it come back through here
        if ('deleted' in branch && branch.deleted !== deleted) {
            throw new InternalError(
                `${this.entityClass.name}: which soft deleted rows a call reaches is chosen by its "deleted" option,`
                + ' not by its filter. Pass { deleted: \'only\' } for the soft deleted rows alone,'
                + ' or { deleted: \'include\' } for every row.'
            );
        }
        return { ...branch, deleted };
    }
}