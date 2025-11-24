import { setTimeout } from 'timers/promises';
import { isDeepStrictEqual } from 'util';

import { Repository as TORepository } from 'typeorm';

import { BaseRepositoryOptions, CreateAllOptions, CreateOptions, UpdateAllOptions, UpdateByIdOptions, Where } from '../data-source';
import { Repository } from '../data-source/repository';
import { DeepPartial, Newable } from '../types';
import { ChangeSet, ChangeSetEntity, ChangeSetType, CreateChangeSetData, NewChange } from './models';
import { AuthServiceInterface, BaseUser } from '../auth';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { PropertyMetadata } from '../entity';
import { BadRequestError } from '../error-handling';
import { HttpRequest } from '../http';
import { chunkedPromiseAll, MetadataUtilities } from '../utilities';

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
    protected readonly keysToExcludeFromChangeSets: (keyof T)[];

    private get changeSetRepository(): Repository<ChangeSet, CreateChangeSetData> {
        return inject(repositoryTokenFor(ChangeSet));
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    constructor(entityClass: Newable<T>, repo: TORepository<T> | Repository<T>) {
        super(entityClass, repo);

        this.keysToExcludeFromChangeSets = ['changeSets'];
        const props: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        for (const [key, m] of Object.entries(props)) {
            if (m.excludeFromChangeSets) {
                this.keysToExcludeFromChangeSets.push(key as keyof T);
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
        const res: T = await super.updateById(id, data, options);
        await this.createChangeSet(res, data, ChangeSetType.UPDATE, options);
        return res;
    }

    override async updateAll(where: Where<T>, data: UpdateData, options?: UpdateAllOptions): Promise<T[]> {
        const res: T[] = await super.updateAll(where, data, options);
        await this.createAllChangeSets(res, res.map(() => data), ChangeSetType.UPDATE, options);
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
     * Calls rollbackByDate on the change set date internally.
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
        return this.rollbackToDate(entity, changeSet.createdAt, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the entity with the given id that have happened since the given change set.
     * This DOES NOT preserve any changes that happened after the change set.
     * The given change set and any change sets after that will be deleted in the end.
     * Calls rollbackByDate on the change set date internally.
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
        return this.rollbackToDateById(id, changeSet.createdAt, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the given entity that have happened since the given date.
     * This DOES NOT preserve any changes that happened after the date.
     * Any change sets after the given date will be deleted in the end.
     * @param entity - The entity to rollback.
     * @param date - The date to which the rollback should happen.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToDate(
        entity: T,
        date: Date,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        const changeSets: ChangeSet[] = await this.changeSetRepository.findAll({
            where: { changeSetEntityId: entity.id, createdAt: { after: date } },
            relations: ['changes'],
            order: { createdAt: 'ASC' }
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
     * Rolls back all changes on the entity with the given id that have happened since the given date.
     * This DOES NOT preserve any changes that happened after the date.
     * Any change sets after the given date will be deleted in the end.
     * @param id - The id of the entity to rollback.
     * @param date - The date to which the rollback should happen.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackToDateById(
        id: T['id'],
        date: Date,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<T> {
        const entity: T = await this.findById(id, options);
        return this.rollbackToDate(entity, date, createChangeSet, preserveCreateChangeSet, options);
    }

    /**
     * Rolls back all changes on the entities found with the given where filter to the state of the given date.
     * This DOES NOT preserve any changes that happened after the date.
     * Any change sets after the given date will be deleted in the end.
     * @param date - The date to which the rollback should happen.
     * @param where - A filter to only rollback some entities.
     * @param createChangeSet - Whether or not a change set should be created.
     * @param preserveCreateChangeSet - Whether or not create change sets should be preserved.
     * In that case the entity gets reset to the state after the create change set. Also, the create change set isn't deleted.
     * @param options - Additional options, eg. Transaction.
     * @returns The updated entity.
     */
    async rollbackAllToDate(
        date: Date,
        where?: Where<T>,
        createChangeSet: boolean = true,
        preserveCreateChangeSet: boolean = true,
        options?: BaseRepositoryOptions
    ): Promise<number> {
        const entitiesToRollback: T[] = await this.findAll({ where: where, ...options });
        await chunkedPromiseAll(
            entitiesToRollback.map(e => this.rollbackToDate(e, date, createChangeSet, preserveCreateChangeSet, options))
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
        await setTimeout(1); // TODO: Better way to guarantee a different time stamp on change sets.
        const changeSetData: CreateChangeSetData = {
            changeSetEntityId: entityPriorChanges.id,
            type: type,
            createdAt: new Date(),
            createdBy: await this.getCreatedBy(),
            changes: this.getChangesFromData(entityPriorChanges, data, type)
        };
        if (!force && !changeSetData.changes.length) {
            return;
        }
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
        await setTimeout(1); // TODO: Better way to guarantee a different time stamp on change sets.
        let changeSetData: CreateChangeSetData[] = entitiesPriorChanges.map((e, i) => ({
            changeSetEntityId: e.id,
            type: type,
            createdAt: new Date(),
            createdByUserId: userId,
            changes: this.getChangesFromData(e, data[i], type)
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
        const currentRequest: HttpRequest = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST);
        const user: BaseUser<string> | undefined = await this.authService.getCurrentUser(
            currentRequest,
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
            if (!this.keysToExcludeFromChangeSets.includes(key as keyof T)) {
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
            || JSON.stringify(previousValue) === JSON.stringify(newValue)
        );
    }
}