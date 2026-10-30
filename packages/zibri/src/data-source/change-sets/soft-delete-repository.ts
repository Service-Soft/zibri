import { ChangeSetRepository } from './change-set-repository';
import { SoftDeleteAggregateOptions } from './models/soft-delete-aggregate-options.model';
import { EntitySelection, Projected } from '../../entity/models/entity-selection.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { Aggregated, GroupKeysOf, NumberKeysOf, OrderedKeysOf } from '../models/aggregate.model';
import { KeysetPage, PaginationResult } from '../models/pagination-result.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { isSoftDeleteEntityNewable } from './models/is-soft-delete-entity.function';
import { SoftDeleteCountOptions } from './models/soft-delete-count-options.model';
import { SoftDeleteEntity } from './models/soft-delete-entity.model';
import { SoftDeleteFindAllOptions } from './models/soft-delete-find-all-options.model';
import { SoftDeleteFindAllPaginatedOptions } from './models/soft-delete-find-all-paginated-options.model';
import { SoftDeleteFindByIdOptions } from './models/soft-delete-find-by-id-options.model';
import { SoftDeleteFindOneOptions } from './models/soft-delete-find-one-options.model';
import { SoftDeleteStreamOptions } from './models/soft-delete-stream-options.model';
import { SoftDeleteUpdateAllOptions } from './models/soft-delete-update-all-options.model';
import { SoftDeleteUpdateByIdOptions } from './models/soft-delete-update-by-id-options.model';
import { SoftDeleteWhere, SoftDeleteWhereFilter } from './models/soft-delete-where.model';
import { SoftDeletedRows } from './models/soft-deleted-rows.type';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { UniqueGroup } from '../../entity/models/unique-declaration.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { $ts } from '../../localization/translate.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { AtomicUpdate } from '../models/atomic-update.model';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { DeleteAllOptions } from '../models/options/delete-all-options.model';
import { DeleteByIdOptions } from '../models/options/delete-by-id-options.model';
import { UpsertAllOptions } from '../models/options/upsert-all-options.model';
import { UpsertOptions } from '../models/options/upsert-options.model';
import { UpdateAllData } from '../models/update-all-data.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { OwnedRelationUtilities } from '../owned-relation.utilities';
import { Repository, WrittenUpdate } from '../repository/repository';
import { ScopedWhere, ScopeWhereUtilities } from '../scopes/scope-where.utilities';
import { TenantUtilities } from '../tenancy/tenant.utilities';
import { Transaction } from '../transaction/transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { validateWriteIsNotBlind } from '../validate-write-is-not-blind.function';

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
export type SoftDeleteByIdOptions<T extends BaseEntity = BaseEntity> = DeleteByIdOptions<T> & {
    /**
     * Whether to remove the rows for good. By default they are marked as deleted.
     */
    hardDelete?: boolean
};

/**
 * Options for deleting multiple soft delete entities.
 */
export type SoftDeleteAllOptions<T extends SoftDeleteEntity, R extends boolean = false> = DeleteAllOptions<T, R> & {
    /**
     * Whether to remove the rows for good. By default they are marked as deleted.
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

    /**
     * Judges whether a soft deleted row is among the rows a unique covers.
     */
    private readonly uniqueEvaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

    /**
     * Builds a repository of your own on the one the data source built for the entity: it reads and
     * writes through that one, with its logger, its data source and its change sets.
     * @param entityClass - The entity this repository reads and writes.
     * @param repo - The repository the data source built for it, which this class has to extend.
     */
    constructor(entityClass: Newable<T>, repo: SoftDeleteRepository<T>);
    /**
     * Builds a repository over a driver, or over another repository with parts of its own.
     * @param entityClass - The entity this repository reads and writes.
     * @param repo - The driver, or the repository whose driver is read and written through.
     * @param logger - What the repository logs through.
     * @param dataSource - The data source the repository belongs to.
     * @param authService - Where the user making a change is read from.
     * @param changeSetRepository - Where the change sets are written.
     */
    constructor(
        entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger: LoggerInterface,
        dataSource: DataSourceInterface,
        authService: AuthServiceInterface,
        changeSetRepository: Repository<ChangeSet, CreateChangeSetData>
    );
    constructor(
        entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger?: LoggerInterface,
        dataSource?: DataSourceInterface,
        authService?: AuthServiceInterface,
        changeSetRepository?: Repository<ChangeSet, CreateChangeSetData>
    ) {
        super(
            entityClass,
            repo,
            ...Repository.resolveParts(repo, logger, dataSource),
            ...ChangeSetRepository.resolveChangeSetParts(repo, authService, changeSetRepository)
        );
        this.keysToExcludeFromChangeSets.add('deleted');
        this.keysToExcludeFromChangeSets.add('deletedWith');
    }

    override async findAll<const S extends EntitySelection<T> | undefined = undefined>(
        options?: SoftDeleteFindAllOptions<T, S>
    ): Promise<Projected<T, S>[]> {
        return await super.findAll<S>({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findOne<B extends boolean = true, const S extends EntitySelection<T> | undefined = undefined>(
        options: SoftDeleteFindOneOptions<T, B, S>
    ): Promise<B extends false ? Projected<T, S> | undefined : Projected<T, S>> {
        return await super.findOne<B, S>({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findById<B extends boolean = true, const S extends EntitySelection<T> | undefined = undefined>(
        id: T['id'],
        options?: SoftDeleteFindByIdOptions<T, B, S>
    ): Promise<B extends false ? Projected<T, S> | undefined : Projected<T, S>> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteFindByIdOptions.
        // The guard is the findOne the base reads through, which resolves to this class's override
        // and is handed `deleted` along with everything else
        return await super.findById<B, S>(id, options);
    }

    override async count<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        options?: SoftDeleteCountOptions<T, G>
    ): Promise<Aggregated<T, G, 'count', number>> {
        return await super.count<G>({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async sum<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: NumberKeysOf<T>,
        options?: SoftDeleteAggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'sum', number>> {
        return await super.sum<G>(property, { ...options, where: this.softDeleteWhereToWhere(options?.deleted, options?.where) });
    }

    override async average<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: NumberKeysOf<T>,
        options?: SoftDeleteAggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'average', number | undefined>> {
        return await super.average<G>(property, { ...options, where: this.softDeleteWhereToWhere(options?.deleted, options?.where) });
    }

    override async minimum<K extends OrderedKeysOf<T>, const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: K,
        options?: SoftDeleteAggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'minimum', NonNullable<T[K]> | undefined>> {
        return await super.minimum<K, G>(property, { ...options, where: this.softDeleteWhereToWhere(options?.deleted, options?.where) });
    }

    override async maximum<K extends OrderedKeysOf<T>, const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: K,
        options?: SoftDeleteAggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'maximum', NonNullable<T[K]> | undefined>> {
        return await super.maximum<K, G>(property, { ...options, where: this.softDeleteWhereToWhere(options?.deleted, options?.where) });
    }

    override async exists(options?: SoftDeleteCountOptions<T>): Promise<boolean> {
        return await super.exists({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findAllPaginated<const S extends EntitySelection<T> | undefined = undefined>(
        page: number,
        limit: number,
        options?: SoftDeleteFindAllPaginatedOptions<T, S>
    ): Promise<PaginationResult<Projected<T, S>>> {
        return await super.findAllPaginated<S>(page, limit, {
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async findAllAfter<const S extends EntitySelection<T> | undefined = undefined>(
        cursor: string | undefined,
        limit: number,
        options?: SoftDeleteFindAllPaginatedOptions<T, S>
    ): Promise<KeysetPage<Projected<T, S>>> {
        return await super.findAllAfter<S>(cursor, limit, {
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async* stream<const S extends EntitySelection<T> | undefined = undefined>(
        options?: SoftDeleteStreamOptions<T, S>
    ): AsyncIterable<Projected<T, S>> {
        yield* super.stream<S>({
            ...options,
            where: this.softDeleteWhereToWhere(options?.deleted, options?.where)
        });
    }

    override async upsert(
        identity: DeepPartial<T>,
        create: CreateData,
        onConflict: AtomicUpdate<T>,
        options?: UpsertOptions<T>
    ): Promise<T> {
        await this.validateNotHeldBySoftDeleted(Object.keys(identity), [identity], options);
        return await super.upsert(identity, create, onConflict, options);
    }

    override async upsertAll(
        identity: Extract<keyof T, string>[],
        rows: UpsertRow<T, CreateData>[],
        options?: UpsertAllOptions<T>
    ): Promise<T[]> {
        await this.validateNotHeldBySoftDeleted(identity, rows.map(row => row.create), options);
        return await super.upsertAll(identity, rows, options);
    }

    /**
     * Refuses an upsert whose identity a soft deleted row holds under a unique that still covers it,
     * as a create of the same values is refused.
     *
     * A unique covering only the live rows lets the upsert insert beside the deleted one, so only the
     * uniques that cover the deleted row refuse it: left to the store, the upsert changed the deleted
     * row and handed it back.
     * @param keys - The properties identifying each row.
     * @param identities - What each row holds for them.
     * @param options - The options of the upsert, for its transaction.
     * @throws UniqueConstraintViolationError when a soft deleted row holds one of the identities.
     */
    private async validateNotHeldBySoftDeleted(
        keys: string[],
        identities: object[],
        options: BaseRepositoryOptions | undefined
    ): Promise<void> {
        const tenantProperty: string | undefined = TenantUtilities.resolveOwnership(this.entityClass, this.entityMetadata)?.property;
        // the store finds the row by the identity, led by the tenant where the entity has one
        const covering: UniqueGroup[] = ModelRegistry.get(this.entityClass).keyDescriptor.uniques
            .filter(group => keys.every(key => group.properties.includes(key))
                && group.properties.every(property => keys.includes(property) || property === tenantProperty));
        if (!covering.length || !identities.length) {
            return;
        }
        const where: WhereFilter<T>[] = identities.map(identity => Object.fromEntries(
            keys.map(key => [key, Reflect.get(identity, key)])
        ) as WhereFilter<T>);
        const deleted: T[] = await this.findAll({ where, deleted: 'only', transaction: options?.transaction, limit: 'all' });
        const held: boolean = deleted.some(row => covering.some(group => group.where == undefined
            || this.uniqueEvaluator.matches(row, group.where as Where<T>, this.entityClass)));
        if (held) {
            throw new UniqueConstraintViolationError(this.entityClass.name, keys);
        }
    }

    override async updateAll<R extends boolean = false>(
        where: SoftDeleteWhere<T>,
        data: UpdateAllData<T, UpdateData>,
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

    /**
     * Refuses an update that matched no row, naming a row the caller may see that is soft deleted
     * rather than calling it missing.
     * @param updated - How many rows the write landed on.
     * @param id - The id that was being updated.
     * @param findOptions - The caller's options with their condition dropped.
     * @throws A ConflictError for a soft deleted row the update did not reach, and what the base
     * throws otherwise.
     */
    protected override async validateUpdateWasWritten(
        updated: number,
        id: T['id'],
        findOptions: SoftDeleteFindByIdOptions<T>
    ): Promise<void> {
        // 01 §D12: a row given by its id to a relation of another row is written through updateEach,
        // which leaves soft deleted rows out, and a 404 gave the caller no reason. Read only once the
        // update missed, and under the caller's scope, so it tells them nothing they could not read
        const reachedDeleted: boolean = (findOptions.deleted ?? 'exclude') !== 'exclude';
        if (!updated && !reachedDeleted && await this.findById(id, { ...findOptions, deleted: 'only', required: false }) != undefined) {
            throw new ConflictError($ts`The ${this.entityClass.name} with id "${id}" is deleted.`);
        }
        await super.validateUpdateWasWritten(updated, id, findOptions);
    }

    override async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: SoftDeleteUpdateByIdOptions<T>): Promise<T> {
        // delegates, but cannot be dropped: it is what widens options to SoftDeleteUpdateByIdOptions,
        // so without it `deleted` is not accepted here. No findById of its own - the base reads
        // through this class's override, guard included.
        return await super.updateByIdWithoutChangeSet(id, data, options);
    }

    override async deleteById(id: T['id'], options?: SoftDeleteByIdOptions<T>): Promise<T> {
        return await this.withinTimeout(options, 'deleteById', async () => {
            if (options?.hardDelete === true) {
                // every row, the way a hard deleteAll reaches every row: removing a soft deleted one
                // is how it goes for good, and the guard answered that it was not there
                const everyRow: SoftDeleteByIdOptions<T> & Pick<SoftDeleteFindByIdOptions<T>, 'deleted'>
                    = { ...options, deleted: 'include' };
                return await super.deleteById(id, everyRow);
            }
            // a soft delete is a delete to the caller, so a locked property is named as for any other
            validateWriteIsNotBlind(this.entityClass, undefined, options?.where);
            // one transaction over the read, the write that marks the row deleted and the change set
            // recording it. A hard delete takes none: it writes no change set, so there is nothing
            // for the write to be atomic with
            return await this.inTransaction(options, async transaction => {
                // read first, as the base reads the row of a hard delete: that read is what tells a
                // row that is not there for the caller from one that no longer meets the condition,
                // and from one that is not theirs to change
                await this.resolveRowToDelete(id, { ...options, transaction });
                // then marked the way a bulk delete marks its rows (01 §Q7), the condition judged
                // again as the row is written. The change set is written from the row as marked
                // rather than as read: it records the delete and no change, so the two are the same
                const { where, ...rest }: SoftDeleteByIdOptions<T> = options ?? {};
                const [marked]: T[] = await this.markDeleted(this.resolveWhereOfRow(id, where), { ...rest, transaction });
                if (marked == undefined) {
                    throw new ConflictError(
                        $ts`The ${this.entityClass.name} with id "${id}" changed since it was read, so it was not deleted.`
                    );
                }
                return marked;
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
            validateWriteIsNotBlind(this.entityClass, undefined, this.softDeleteWhereToWhere('exclude', where));

            return await this.inTransaction(options, async transaction => {
                const res: T[] = await this.markDeleted(where, { ...options, transaction });
                return (options?.returnDeleted === true ? res : res.length) as R extends true ? T[] : number;
            });
        });
    }

    /**
     * Marks the rows matching a filter deleted on their own, records it, and does the same to the
     * rows of their relations that are removed along with them.
     * @param where - The filter naming the rows.
     * @param options - The options of the delete, holding the transaction it runs in.
     * @returns The rows it marked.
     */
    private async markDeleted(
        where: SoftDeleteWhere<T>,
        options: SoftDeleteAllOptions<T, boolean> & Pick<Required<SoftDeleteAllOptions<T, boolean>>, 'transaction'>
    ): Promise<T[]> {
        // through saveUpdateAll rather than updateAllWithoutChangeSet: a soft delete is an update,
        // and its change sets are written from the entities it wrote, so they are read whether or not
        // the caller wants them back - which is exactly the distinction saveUpdateAll draws
        const res: T[] = (await this.saveUpdateAll(
            this.softDeleteWhereToWhere('exclude', where),
            // eslint-disable-next-line unicorn/no-null
            { deleted: true, deletedWith: null } as UpdateData,
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
     * The filter naming one row under the condition the caller gave: the id, put on every branch
     * of the condition.
     * @param id - The id of the row.
     * @param where - The condition, if the caller gave one.
     * @returns The filter.
     * @throws A NotFoundError when the condition contradicts the id, which no row meets.
     */
    private resolveWhereOfRow(id: T['id'], where: Where<T> | undefined): Where<T> {
        // composed rather than spread, as an update by id composes them: the condition may be an OR
        // of several filters, and the id has to hold for every branch of it
        const withId: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(
            where,
            [{ id } as WhereFilter<T>],
            MetadataUtilities.getModelProperties(this.entityClass)
        );
        if (withId.matchesNothing || withId.where == undefined) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return withId.where;
    }

    /**
     * Soft deletes the rows of the relations removed along with the given rows, noting which row took
     * each along - so restoring that row restores them, and not rows deleted on their own before.
     *
     * Every row of them, whoever may see it, as a hard delete takes every row.
     * @param ownerIds - The ids of the rows just marked deleted.
     * @param transaction - The transaction the delete runs in.
     */
    private async softDeleteOwnedRows(ownerIds: string[], transaction: Transaction): Promise<void> {
        if (!ownerIds.length) {
            return;
        }
        for (const relation of OwnedRelationUtilities.resolveAll(this.entityClass)) {
            // one that does not soft delete is refused when the application starts
            if (!relation.cascadesRemove || !isSoftDeleteEntityNewable(relation.target)) {
                continue;
            }
            const repository: SoftDeleteRepository<SoftDeleteEntity> = this.dataSource.getRepository(relation.target);
            await repository.markDeletedAlong(relation.foreignKey, ownerIds, transaction);
        }
    }

    /**
     * Marks the rows of the given owners deleted, each noting its own owner, records it, and does the
     * same to the rows of their relations in turn.
     *
     * Each row notes a value of its own, which one update over every row cannot write: the rows are
     * read once and written in one call that gives each its own values, however many owners there
     * are. A row deleted on its own in between is left out, as the update would have left it.
     * @param foreignKey - The property each row names its owner by.
     * @param ownerIds - The ids of the owners just marked deleted.
     * @param transaction - The transaction the delete runs in.
     */
    private async markDeletedAlong(foreignKey: string, ownerIds: string[], transaction: Transaction): Promise<void> {
        const options: BaseRepositoryOptions = { transaction, unscoped: true, acrossTenants: true };
        // only what the write needs: no relation, and nothing decrypted for rows about to be marked
        const owned: T[] = await this.findAll({
            ...options,
            where: { [foreignKey]: { oneOf: ownerIds } } as SoftDeleteWhere<T>,
            limit: 'all',
            relations: [],
            autoDecrypt: false
        });
        const res: T[] = (await this.saveUpdateEach(
            owned.map(row => ({ id: row.id, deleted: true, deletedWith: String(Reflect.get(row, foreignKey)) } as UpdateData)),
            options,
            this.softDeleteWhereToWhere('exclude')
        )).map(u => u.entity);
        await this.createAllChangeSets(
            res,
            res.map(() => ({ deleted: true } as UpdateData)),
            ChangeSetType.DELETE,
            options,
            true
        );
        await this.softDeleteOwnedRows(res.map(r => r.id), transaction);
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

    protected override async createChangeSet(
        entityPriorChanges: T,
        data: CreateData | UpdateData | DeepPartial<T>,
        type: ChangeSetType,
        options?: BaseRepositoryOptions,
        force: boolean = false
    ): Promise<void> {
        if (this.isRestore(entityPriorChanges, data, type)) {
            await super.createChangeSet(entityPriorChanges, data, ChangeSetType.RESTORE, options, true);
            return;
        }
        await super.createChangeSet(entityPriorChanges, data, type, options, force);
    }

    protected override async createAllChangeSets(
        entitiesPriorChanges: T[],
        data: (CreateData | UpdateData | DeepPartial<T>)[],
        type: ChangeSetType,
        options?: BaseRepositoryOptions,
        force: boolean = false
    ): Promise<void> {
        const restored: number[] = entitiesPriorChanges.map((_, index) => index)
            .filter(index => this.isRestore(entitiesPriorChanges[index], data[index], type));
        if (!restored.length) {
            await super.createAllChangeSets(entitiesPriorChanges, data, type, options, force);
            return;
        }
        const others: number[] = entitiesPriorChanges.map((_, index) => index).filter(index => !restored.includes(index));
        await super.createAllChangeSets(
            others.map(index => entitiesPriorChanges[index] as T),
            others.map(index => data[index] as CreateData | UpdateData | DeepPartial<T>),
            type,
            options,
            force
        );
        await super.createAllChangeSets(
            restored.map(index => entitiesPriorChanges[index] as T),
            restored.map(index => data[index] as CreateData | UpdateData | DeepPartial<T>),
            ChangeSetType.RESTORE,
            options,
            true
        );
    }

    /**
     * Whether an update brings back a row that was soft deleted. Recorded as a restore of its own, as
     * its delete is: `deleted` is left out of every change set, so the update alone recorded nothing
     * and the history of a live row ended at its delete.
     * @param entityPriorChanges - The row before the update.
     * @param data - What the update writes.
     * @param type - What the change set would record.
     * @returns True for an update taking a deleted row back.
     */
    private isRestore(
        entityPriorChanges: T | undefined,
        data: CreateData | UpdateData | DeepPartial<T> | undefined,
        type: ChangeSetType
    ): boolean {
        return type === ChangeSetType.UPDATE && entityPriorChanges?.deleted === true && data?.deleted === false;
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