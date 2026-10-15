import { isDeepStrictEqual } from 'node:util';

import { AuthServiceInterface } from '../auth/auth-service.interface';
import { ChangeSetEntity } from './models/change-set-entity.model';
import { ChangeSetType } from './models/change-set-type.enum';
import { ChangeSet, CreateChangeSetData } from './models/change-set.model';
import { NewChange } from './models/change.model';
import { BaseUser } from '../auth/models/base-user.model';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { RepositoryDriverInterface } from '../data-source/driver/repository-driver.interface';
import { BeforeReturnHook } from '../data-source/hooks/before-return';
import { BeforeSaveHook } from '../data-source/hooks/before-save';
import { BaseRepositoryOptions } from '../data-source/models/options/base-repository-options.model';
import { CreateAllOptions } from '../data-source/models/options/create-all-options.model';
import { CreateOptions } from '../data-source/models/options/create-options.model';
import { UpdateAllOptions } from '../data-source/models/options/update-all-options.model';
import { UpdateByIdOptions } from '../data-source/models/options/update-by-id-options.model';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository, WrittenUpdate } from '../data-source/repository/repository';
import { ScopedWhere } from '../data-source/scopes/scope-where.utilities';
import { TenantUtilities } from '../data-source/tenancy/tenant.utilities';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { InternalError } from '../error-handling/internal-error.model';
import { removeExcludeProperties } from '../global/model-registry/remove-exclude-properties.function';
import { restoreExcludeProperties } from '../global/model-registry/restore-exclude-properties.function';
import { $ts } from '../localization/translate.function';
import { LoggerInterface } from '../logging/logger.interface';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { nowInNs } from '../utilities/now-in-ns.function';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';

/**
 * The result for resetting a change set on an entity.
 */
export type ResetChangeSetResult<T extends ChangeSetEntity> = {
    /**
     * The entity after the change set has been reset.
     */
    entity: T,
    /**
     * The values that were changed by resetting the change set.
     */
    changedValues: DeepPartial<T>
};

/**
 * A base repository that automatically handles creation of change sets.
 */
export class ChangeSetRepository<
    T extends ChangeSetEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> extends Repository<T, CreateData, UpdateData> {

    /**
     * Any keys that should be excluded from the change set.
     */
    protected readonly keysToExcludeFromChangeSets: Set<keyof T> = new Set();

    constructor(
        entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger: LoggerInterface,
        dataSource: DataSourceInterface,
        beforeSave: BeforeSaveHook<T, CreateData, UpdateData>,
        beforeReturn: BeforeReturnHook<T>,
        private readonly authService: AuthServiceInterface,
        private readonly changeSetRepository: Repository<ChangeSet, CreateChangeSetData>

    ) {
        super(entityClass, repo, logger, dataSource, beforeSave, beforeReturn);

        this.keysToExcludeFromChangeSets.add('changeSets');
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        for (const [key, m] of ObjectUtilities.entries(props)) {
            if (m.excludeFromChangeSets) {
                this.keysToExcludeFromChangeSets.add(key as keyof T);
            }
        }
    }

    override async create(data: CreateData, options?: CreateOptions<T>): Promise<T> {
        // one transaction over the write and the change set describing it, for the reason `updateAll`
        // takes one: written apart, a failure in between leaves either a mutation nothing recorded or
        // a record of a mutation that was rolled back. A trail with a hole in it is worse than no
        // trail, because it reads as complete. `inTransaction` uses the caller's when they passed one
        return await this.inTransaction(options, async transaction => {
            const inTransaction: CreateOptions<T> = { ...options, transaction };
            const res: T = await super.create(data, inTransaction);
            await this.createChangeSet(res, res, ChangeSetType.CREATE, inTransaction);
            return res;
        });
    }

    override async createAll(data: CreateData[], options?: CreateAllOptions<T>): Promise<T[]> {
        return await this.inTransaction(options, async transaction => {
            const inTransaction: CreateAllOptions<T> = { ...options, transaction };
            const res: T[] = await super.createAll(data, inTransaction);
            await this.createAllChangeSets(res, res, ChangeSetType.CREATE, inTransaction);
            return res;
        });
    }

    override async updateById(id: T['id'], data: UpdateData, options?: UpdateByIdOptions<T>): Promise<T> {
        // this read is the existence check too, so it calls saveUpdate rather than super.updateById -
        // the base would otherwise read the same row again purely to prove it is there. Without the
        // caller's condition for the same reason the base leaves it out: the before state of a row is
        // what it holds, not what the write is about to require of it
        return await this.inTransaction(options, async transaction => {
            const inTransaction: UpdateByIdOptions<T> = { ...options, transaction };
            // `where: undefined` drops the caller's compare and set condition for the read only -
            // `unscoped` and everything else the caller asked for is carried through, and the
            // entity's own scope is applied inside `findById` rather than passed to it
            const original: T = await this.findById(id, { ...inTransaction, where: undefined });
            // `written` rather than `data`: a change set records what happened, and what happened is
            // the caller's change plus whatever the save hooks put on it - a `default` among them.
            // Reading the row back instead would be worse than either: it also carries every column
            // nobody touched, and anything another writer changed in between, which this would then
            // claim.
            const { entity, written }: WrittenUpdate<T> = await this.saveUpdate(id, data, inTransaction);
            await this.createChangeSet(original, written, ChangeSetType.UPDATE, inTransaction);
            return entity;
        });
    }

    override async updateAll<R extends boolean = false>(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        // one transaction over the read, the update and the change sets. Taken here rather than left
        // to the base, so that the change sets commit or roll back with the update they describe -
        // otherwise an update that succeeded could be left with no record of who made it.
        return await this.inTransaction(options, async transaction => {
            const inTransaction: UpdateAllOptions<T, boolean> = { ...options, transaction };
            // before the write, because this is the before state: read afterwards it would be the
            // rows as the update left them, every column would compare equal to itself, and every
            // change set would come out empty
            // every matching row, because the update below writes every matching row - the two have
            // to cover the same set or the change sets describe a different update than the one that
            // happened. That a bulk update reads its rows at all is 01-data-layer M3
            const reach: ScopedWhere<T> = this.resolveWriteWhere(where, inTransaction);
            const original: T[] = reach.matchesNothing ? [] : await this.findAll({ where: reach.where, ...inTransaction, take: 'all' });
            const originalById: Map<T['id'], T> = new Map(original.map(row => [row.id, row]));

            const updates: WrittenUpdate<T>[] = await this.saveUpdateAll(where, data, inTransaction);
            await this.createAllChangeSets(
                updates.map(u => originalById.get(u.entity.id) ?? u.entity),
                updates.map(u => u.written),
                ChangeSetType.UPDATE,
                inTransaction
            );
            // the entities were read either way, because a change set cannot be written without
            // them. What the caller asked for still decides what they are handed.
            return (options?.returnUpdated === true ? updates.map(u => u.entity) : updates.length) as R extends true ? T[] : number;
        });
    }

    /**
     * Update an entity by id with property/value pairs in the data object.
     * @param id - Value for the entity id.
     * @param data - Data attributes to be updated.
     * @param options - Options for the operations.
     * @returns
     * A promise that will be resolve if the operation succeeded or will be rejected if the entity was not found.
     */
    async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: UpdateByIdOptions<T>): Promise<T> {
        return await super.updateById(id, data, options);
    }

    /**
     * Updates all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns How many entities were updated, or the entities themselves when `returnUpdated` asked
     * for them.
     */
    async updateAllWithoutChangeSet<R extends boolean = false>(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        return await super.updateAll(where, data, options);
    }

    /**
     * Resets the changes of a single change set on the given entity to the state before the change set.
     * This DOES preserve any changes that happened after the change set.
     * The given change set gets deleted afterwards.
     * @param entity - The entity that should be reset.
     * @param changeSetId - The id of the changeSet to reset.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async resetSingleChangeSet(
        entity: T,
        changeSetId: string,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<ResetChangeSetResult<T>> {
        // three writes - the row, the change set recording the reset, and the deletion of the change
        // set being undone - so all the more reason for them to land together. A reset that wrote the
        // row and then failed to delete the change set it undid would offer that change set to be
        // undone a second time
        return await this.inTransaction(options, async transaction => {
            const inTransaction: BaseRepositoryOptions = { ...options, transaction };
            const changeSet: ChangeSet = await this.changeSetRepository.findById(
                changeSetId,
                { relations: ['changes'], ...inTransaction }
            );
            if (changeSet.changeSetEntityId !== entity.id) {
                throw new BadRequestError(
                    $ts`Could not reset the changes from the change set: The changeSet doesn\'t belong to the entity with the given id.`
                );
            }
            const data: DeepPartial<T> = {} as DeepPartial<T>;
            for (const change of changeSet.changes) {
                const key: keyof DeepPartial<T> = change.key as keyof DeepPartial<T>;
                data[key] = preserveCreateChangeSet && changeSet.type === ChangeSetType.CREATE
                    ? change.newValue as DeepPartial<T>[keyof DeepPartial<T>]
                    : change.previousValue as DeepPartial<T>[keyof DeepPartial<T>];
            }
            // `saveUpdate` rather than `updateByIdWithoutChangeSet`, for the written change: a reset
            // is a write like any other, so the hooks add to it, and the change set recording the
            // reset has to say what the reset actually did. The existence check the public method
            // performs is redundant here - the row was passed in.
            const { written }: WrittenUpdate<T> = await this.saveUpdate(entity.id, data as UpdateData, inTransaction);
            if (createChangeSet) {
                await this.createChangeSet(entity, written, ChangeSetType.RESET, inTransaction);
            }
            if (!preserveCreateChangeSet || changeSet.type !== ChangeSetType.CREATE) {
                await this.changeSetRepository.deleteById(changeSet.id, inTransaction);
            }
            // the written change rather than the one assembled from the stored values, so a caller
            // aggregating several resets - the method below does - aggregates what landed
            return { entity: await this.findById(entity.id, inTransaction), changedValues: written };
        });
    }

    /**
     * Resets the changes of a single change set on the entity with the given id to the state before the oldest change set.
     * This DOES preserve any changes that happened after the change set.
     * The given change set gets deleted afterwards.
     * @param id - The id of the entity that should be reset.
     * @param changeSetId - The id of the changeSet to reset.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async resetSingleChangeSetById(
        id: T['id'],
        changeSetId: string,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<ResetChangeSetResult<T>> {
        const entity: T = await this.findById(id, options);
        return this.resetSingleChangeSet(entity, changeSetId, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the given entity that have happened since the given change set.
     * This DOES NOT preserve any changes that happened after the change set.
     * The given change set and any change sets after that will be deleted in the end.
     * Calls rollbackToTimestamp on the change set timestamp internally.
     * @param entity - The entity to rollback.
     * @param changeSetId - The id of the changeSet to rollback to.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToChangeSet(
        entity: T,
        changeSetId: string,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        const changeSet: ChangeSet = await this.changeSetRepository.findById(changeSetId, options);
        return this.rollbackToTimestamp(entity, changeSet.createdAt, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the entity with the given id that have happened since the given change set.
     * This DOES NOT preserve any changes that happened after the change set.
     * The given change set and any change sets after that will be deleted in the end.
     * Calls rollbackToTimestampById on the change set timestamp internally.
     * @param id - The id of the entity to rollback.
     * @param changeSetId - The id of the changeSet to rollback to.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToChangeSetById(
        id: T['id'],
        changeSetId: string,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        const changeSet: ChangeSet = await this.changeSetRepository.findById(changeSetId);
        if (changeSet.changeSetEntityId !== id) {
            throw new BadRequestError(
                $ts`Could not rollback to the given change set: The changeSet doesn\'t belong to the entity with the given id.`
            );
        }
        return this.rollbackToTimestampById(id, changeSet.createdAt, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the given entity that have happened since the given timestamp.
     * This DOES NOT preserve any changes that happened after the timestamp.
     * Any change sets after the given timestamp will be deleted in the end.
     * @param entity - The entity to rollback.
     * @param timestampInNs - The timestamp to which the rollback should happen with nanosecond precision.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToTimestamp(
        entity: T,
        timestampInNs: bigint,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        // one transaction over every reset this walks through, so a rollback that fails partway does
        // not leave the row at a state it was never in - between two of the change sets it is
        // undoing, which is not a state anything recorded
        return await this.inTransaction(options, async transaction => {
            const inTransaction: BaseRepositoryOptions = { ...options, transaction };
            const changeSets: ChangeSet[] = await this.changeSetRepository.findAll({
                // every change since the timestamp, because a rollback that skipped some would land
                // the row somewhere it never was
                take: 'all',
                where: { changeSetEntityId: entity.id, createdAt: { greaterThan: timestampInNs } },
                relations: ['changes'],
                ...inTransaction
            });
            let data: DeepPartial<T> = {} as DeepPartial<T>;
            for (const changeSet of changeSets) {
                const changedValues: DeepPartial<T> = (await this.resetSingleChangeSet(
                    entity,
                    changeSet.id,
                    false,
                    preserveCreateChangeSet,
                    inTransaction
                )).changedValues;
                data = { ...data, ...changedValues };
            }
            if (createChangeSet) {
                await this.createChangeSet(entity, data, ChangeSetType.RESET, inTransaction);
            }
            return await this.findById(entity.id, inTransaction);
        });
    }

    /**
     * Rolls back all changes on the entity with the given id that have happened since the given timestamp.
     * This DOES NOT preserve any changes that happened after the timestamp.
     * Any change sets after the given timestamp will be deleted in the end.
     * @param id - The id of the entity to rollback.
     * @param timestampInNs - The timestamp to which the rollback should happen with nanosecond precision.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToTimestampById(
        id: T['id'],
        timestampInNs: bigint,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        const entity: T = await this.findById(id, options);
        return this.rollbackToTimestamp(entity, timestampInNs, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the entities found with the given where filter to the state of the given timestamp.
     * This DOES NOT preserve any changes that happened after the timestamp.
     * Any change sets after the given timestamp will be deleted in the end.
     * @param timestampInNs - The timestamp to which the rollback should happen with nanosecond precision.
     * @param where - A filter to only rollback some entities.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackAllToTimestamp(
        timestampInNs: bigint,
        where?: Where<T>,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<number> {
        // one transaction over all of them, for the same reason the singular version takes one over
        // its own resets: rolling back half the rows the filter matched is not a rollback of that
        // filter, and nothing afterwards says which half it got to
        return await this.inTransaction(options, async transaction => {
            const inTransaction: BaseRepositoryOptions = { ...options, transaction };
            // a rollback covers everything the filter matches or it is not a rollback of that filter -
            // of the rows it may change, which inside a tenant leaves out the ones of no tenant
            const reach: ScopedWhere<T> = this.resolveWriteWhere(where, inTransaction);
            const entitiesToRollback: T[] = reach.matchesNothing
                ? []
                : await this.findAll({ where: reach.where, ...inTransaction, take: 'all' });
            await PromiseUtilities.allChunked(
                entitiesToRollback,
                e => this.rollbackToTimestamp(e, timestampInNs, createChangeSet, preserveCreateChangeSet, inTransaction)
            );
            return entitiesToRollback.length;
        });
    }

    /**
     * Creates a change set for the related entity id.
     * Also generates the changes from the given data.
     * @param entityPriorChanges - The entity for which the change set gets created.
     * @param data - The data of the operation eg. The update body.
     * @param type - Whether the change set is for create, update or delete.
     * @param options - The transaction the change set is written in, which is the only part of the
     * caller's options that belongs to it: everything else says something about the entity being
     * changed rather than about the row recording the change.
     * @param force - Whether or not the creation of a change set without changes should be forced.
     */
    protected async createChangeSet(
        entityPriorChanges: T,
        data: CreateData | UpdateData | DeepPartial<T>,
        type: ChangeSetType,
        options?: BaseRepositoryOptions,
        force: boolean = false
    ): Promise<void> {
        restoreExcludeProperties(entityPriorChanges, this.entityClass);
        restoreExcludeProperties(data, this.entityClass);
        const changes: NewChange[] = this.getChangesFromData(entityPriorChanges, data, type);
        await Promise.all([
            removeExcludeProperties(entityPriorChanges, this.entityClass),
            removeExcludeProperties(data, this.entityClass)
        ]);

        if (!force && !changes.length) {
            return;
        }

        const changeSetData: CreateChangeSetData = {
            tenantId: this.resolveChangeSetTenant(entityPriorChanges),
            changeSetEntityId: entityPriorChanges.id,
            type: type,
            createdAt: nowInNs(),
            createdBy: await this.getCreatedBy(),
            changes
        };
        await this.changeSetRepository.create(changeSetData, { transaction: options?.transaction, acrossTenants: true });
    }

    /**
     * Resolves the tenant a change set belongs to: the one of the row it describes.
     *
     * Rather than the tenant active while the change is written, which is none for a change made
     * across tenants - and a change set of no tenant is history every tenant reads.
     * @param row - The row the change set describes.
     * @returns Its tenant, or null for a row of no tenant.
     */
    private resolveChangeSetTenant(row: T): string | null {
        // eslint-disable-next-line unicorn/no-null
        return TenantUtilities.resolveTenantOf(row, this.entityClass) ?? null;
    }

    /**
     * Creates all change sets for the related entities.
     * Also generates the changes from the given data.
     * @param entitiesPriorChanges - The entities to create the change sets for.
     * @param data - The data of the operation eg. The update bodies.
     * @param type - Whether the change set is for create, update or delete.
     * @param options - The transaction the change sets are written in, which is the only part of
     * the caller's options that belongs to them.
     * @param force - Whether or not the creation of a change set without changes should be forced.
     */
    protected async createAllChangeSets(
        entitiesPriorChanges: T[],
        data: (CreateData | UpdateData | DeepPartial<T>)[],
        type: ChangeSetType,
        options?: BaseRepositoryOptions,
        force: boolean = false
    ): Promise<void> {
        const userId: string | undefined = await this.getCreatedBy();

        // the return type is stated so that the literal below is checked against it. Inferred, an
        // extra key is not an error - which is how `createdByUserId` came to be written here for a
        // field the entity calls `createdBy`, leaving every bulk change set with no actor on it
        let changeSetData: CreateChangeSetData[] = await Promise.all(
            entitiesPriorChanges.map(async (e, i): Promise<CreateChangeSetData> => {
                // one per entity, in the same order - the caller pairs them up
                const entityData: CreateData | UpdateData | DeepPartial<T> | undefined = data[i];
                if (entityData == undefined) {
                    throw new InternalError(`No data was given for the change set of "${this.entityClass.name}" at position ${i}.`);
                }
                restoreExcludeProperties(e, this.entityClass);
                restoreExcludeProperties(entityData, this.entityClass);
                const changes: NewChange[] = this.getChangesFromData(e, entityData, type);
                await Promise.all([
                    removeExcludeProperties(e, this.entityClass),
                    removeExcludeProperties(entityData, this.entityClass)
                ]);

                return {
                    tenantId: this.resolveChangeSetTenant(e),
                    changeSetEntityId: e.id,
                    type,
                    createdAt: nowInNs(),
                    createdBy: userId,
                    changes
                };
            })
        );
        if (!force) {
            changeSetData = changeSetData.filter(d => d.changes.length);
        }
        if (!force && !changeSetData.length) {
            return;
        }
        await this.changeSetRepository.createAll(changeSetData, { transaction: options?.transaction, acrossTenants: true });
    }

    /**
     * Get all changes from the given data that should be added to a new change set.
     * @param entityPriorChanges - The entity that has been changed.
     * @param data - The changed data.
     * @param type - The type of the change set to create.
     * @returns An array of changes for the change set.
     * Filtered by values that have actually changed and aren't in the "keysToExcludeFromChangeSets" array.
     */
    protected getChangesFromData(entityPriorChanges: T, data: CreateData | UpdateData | DeepPartial<T>, type: ChangeSetType): NewChange[] {
        const res: NewChange[] = [];
        for (const key of this.getKeysToIncludeInChangeSet(data)) {
            const previousValue: T[keyof T] | undefined = type === ChangeSetType.CREATE ? undefined : entityPriorChanges[key];
            if (this.hasValueChanged(previousValue, data[key] as CreateData[keyof CreateData])) {
                res.push({
                    key: String(key),
                    previousValue: previousValue,
                    newValue: data[key]
                });
            }
        }
        return res;
    }

    /**
     * Tries to get a currently logged in user.
     * @returns The id of the currently logged in user or undefined if that didn't work.
     */
    protected async getCreatedBy(): Promise<string | undefined> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
        if (!context) {
            return undefined;
        }
        const user: BaseUser<string> | undefined = await this.authService.getCurrentUser(
            context,
            this.authService.strategies,
            false
        );
        return user?.id;
    }

    /**
     * Gets the keys of values that should be included in change sets.
     * @param data - The new values.
     * @returns The keys that should be included in the change set.
     */
    protected getKeysToIncludeInChangeSet(
        data: CreateData | UpdateData | DeepPartial<T>
    ): (keyof (CreateData | UpdateData | DeepPartial<T>))[] {
        const keys: (keyof (CreateData | UpdateData | DeepPartial<T>))[] = [];
        for (const key in data) {
            if (
                !this.keysToExcludeFromChangeSets.has(key as keyof T)
                // we need to use triple equals here, setting a value to null is valid and should be tracked
                && data[key as keyof (CreateData | UpdateData | DeepPartial<T>)] !== undefined
            ) {
                keys.push(key as keyof (CreateData | UpdateData | DeepPartial<T>));
            }
        }
        return keys;
    }

    /**
     * Checks whether or not a value has actually changed.
     * This is used to determine whether or not a change should be created or not.
     * @param previousValue - The value before any changes.
     * @param newValue - The value after changes.
     * @returns Whether or not the given values are not equal.
     */
    protected hasValueChanged(
        previousValue?: T[keyof T],
        newValue?: CreateData[keyof CreateData] | UpdateData[keyof UpdateData] | DeepPartial<T>[keyof DeepPartial<T>]
    ): boolean {
        return !(
            isDeepStrictEqual(previousValue, newValue)
            || JsonUtilities.stringify(previousValue) === JsonUtilities.stringify(newValue)
        );
    }
}