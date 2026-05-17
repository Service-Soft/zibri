import { isDeepStrictEqual } from 'node:util';

import { Repository as TORepository } from 'typeorm';

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
import { BeforeReturnHook } from '../data-source/hooks/before-return';
import { BeforeSaveHook } from '../data-source/hooks/before-save';
import { BaseRepositoryOptions } from '../data-source/models/options/base-repository-options.model';
import { CreateAllOptions } from '../data-source/models/options/create-all-options.model';
import { CreateOptions } from '../data-source/models/options/create-options.model';
import { UpdateAllOptions } from '../data-source/models/options/update-all-options.model';
import { UpdateByIdOptions } from '../data-source/models/options/update-by-id-options.model';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { removeExcludeProperties } from '../global/model-registry/remove-exclude-properties.function';
import { restoreExcludeProperties } from '../global/model-registry/restore-exclude-properties.function';
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
        repo: TORepository<T> | Repository<T>,
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

    override async create(data: CreateData, options?: CreateOptions): Promise<T> {
        const res: T = await super.create(data, options);
        await this.createChangeSet(res, res, ChangeSetType.CREATE, options);
        return res;
    }

    override async createAll(data: CreateData[], options?: CreateAllOptions): Promise<T[]> {
        const res: T[] = await super.createAll(data, options);
        await this.createAllChangeSets(res, res, ChangeSetType.CREATE, options);
        return res;
    }

    override async updateById(id: T['id'], data: UpdateData, options?: UpdateByIdOptions): Promise<T> {
        const original: T = await this.findById(id, options);
        const res: T = await super.updateById(id, data, options);
        await this.createChangeSet(original, data, ChangeSetType.UPDATE, options);
        return res;
    }

    override async updateAll(where: Where<T>, data: UpdateData, options?: UpdateAllOptions): Promise<T[]> {
        const original: T[] = await this.findAll({ where, ...options });
        const res: T[] = await super.updateAll(where, data, options);
        await this.createAllChangeSets(original, original.map(() => data), ChangeSetType.UPDATE, options);
        return res;
    }

    /**
     * Update an entity by id with property/value pairs in the data object.
     * @param id - Value for the entity id.
     * @param data - Data attributes to be updated.
     * @param options - Options for the operations.
     * @returns
     * A promise that will be resolve if the operation succeeded or will be rejected if the entity was not found.
     */
    async updateByIdWithoutChangeSet(id: T['id'], data: UpdateData, options?: UpdateByIdOptions): Promise<T> {
        return await super.updateById(id, data, options);
    }

    /**
     * Updates all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns An array of all the updated entities.
     */
    async updateAllWithoutChangeSet(where: Where<T>, data: UpdateData, options?: UpdateAllOptions): Promise<T[]> {
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
        const changeSet: ChangeSet = await this.changeSetRepository.findById(changeSetId, { relations: ['changes'], ...options });
        if (changeSet.changeSetEntityId !== entity.id) {
            throw new BadRequestError(
                'Could not reset the changes from the change set: The changeSet doesn\'t belong to the entity with the given id.'
            );
        }
        const data: DeepPartial<T> = {} as DeepPartial<T>;
        for (const change of changeSet.changes) {
            const key: keyof DeepPartial<T> = change.key as keyof DeepPartial<T>;
            data[key] = preserveCreateChangeSet && changeSet.type === ChangeSetType.CREATE
                ? change.newValue as DeepPartial<T>[keyof DeepPartial<T>]
                : change.previousValue as DeepPartial<T>[keyof DeepPartial<T>];
        }
        await this.updateByIdWithoutChangeSet(entity.id, data as UpdateData, options);
        if (createChangeSet) {
            await this.createChangeSet(entity, data, ChangeSetType.RESET, options);
        }
        if (!preserveCreateChangeSet || changeSet.type !== ChangeSetType.CREATE) {
            await this.changeSetRepository.deleteById(changeSet.id, options);
        }
        return { entity: await this.findById(entity.id, options), changedValues: data };
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
                'Could not rollback to the given change set: The changeSet doesn\'t belong to the entity with the given id.'
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
        const changeSets: ChangeSet[] = await this.changeSetRepository.findAll({
            where: { changeSetEntityId: entity.id, createdAt: { greaterThan: timestampInNs } },
            relations: ['changes']
        });
        let data: DeepPartial<T> = {} as DeepPartial<T>;
        for (const changeSet of changeSets) {
            const changedValues: DeepPartial<T> = (await this.resetSingleChangeSet(
                entity,
                changeSet.id,
                false,
                preserveCreateChangeSet,
                options
            )).changedValues;
            data = { ...data, ...changedValues };
        }
        if (createChangeSet) {
            await this.createChangeSet(entity, data, ChangeSetType.RESET, options);
        }
        return await this.findById(entity.id, options);
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
        const entitiesToRollback: T[] = await this.findAll({ where: where, ...options });
        await PromiseUtilities.allChunked(
            entitiesToRollback,
            e => this.rollbackToTimestamp(e, timestampInNs, createChangeSet, preserveCreateChangeSet, options)
        );
        return entitiesToRollback.length;
    }

    /**
     * Creates a change set for the related entity id.
     * Also generates the changes from the given data.
     * @param entityPriorChanges - The entity for which the change set gets created.
     * @param data - The data of the operation eg. The update body.
     * @param type - Whether the change set is for create, update or delete.
     * @param options - Additional options (e.g. Transaction etc.).
     * @param force - Whether or not the creation of a change set without changes should be forced.
     */
    protected async createChangeSet(
        entityPriorChanges: T,
        data: CreateData | UpdateData | DeepPartial<T>,
        type: ChangeSetType,
        options?: CreateOptions,
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
            changeSetEntityId: entityPriorChanges.id,
            type: type,
            createdAt: nowInNs(),
            createdBy: await this.getCreatedBy(),
            changes
        };
        await this.changeSetRepository.create(changeSetData, options);
    }

    /**
     * Creates all change sets for the related entities.
     * Also generates the changes from the given data.
     * @param entitiesPriorChanges - The entities to create the change sets for.
     * @param data - The data of the operation eg. The update bodies.
     * @param type - Whether the change set is for create, update or delete.
     * @param options - Additional options (e.g. Transaction etc.).
     * @param force - Whether or not the creation of a change set without changes should be forced.
     */
    protected async createAllChangeSets(
        entitiesPriorChanges: T[],
        data: (CreateData | UpdateData | DeepPartial<T>)[],
        type: ChangeSetType,
        options?: CreateOptions,
        force: boolean = false
    ): Promise<void> {
        const userId: string | undefined = await this.getCreatedBy();

        let changeSetData: CreateChangeSetData[] = await Promise.all(entitiesPriorChanges.map(async (e, i) => {
            restoreExcludeProperties(e, this.entityClass);
            restoreExcludeProperties(data[i], this.entityClass);
            const changes: NewChange[] = this.getChangesFromData(e, data[i], type);
            await Promise.all([
                removeExcludeProperties(e, this.entityClass),
                removeExcludeProperties(data[i], this.entityClass)
            ]);

            return {
                changeSetEntityId: e.id,
                type,
                createdAt: nowInNs(),
                createdByUserId: userId,
                changes
            };
        }));
        if (!force) {
            changeSetData = changeSetData.filter(d => d.changes.length);
        }
        if (!force && !changeSetData.length) {
            return;
        }
        await this.changeSetRepository.createAll(changeSetData, options);
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