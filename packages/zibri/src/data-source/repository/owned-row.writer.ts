import { OwnedRowsById } from './owned-rows-by-id.type';
import { ReferenceValidator } from './reference.validator';
import { type Repository, type WrittenUpdate } from './repository';
import { BaseEntity } from '../../entity/base-entity.model';
import { type RelationTree } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { $ts } from '../../localization/translate.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { isSoftDeleteEntityNewable } from '../change-sets/models/is-soft-delete-entity.function';
import { type SoftDeletedRows } from '../change-sets/models/soft-deleted-rows.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { WriteRelationsOptions } from '../models/options/write-relations-options.model';
import { OwnedRelationWrite } from '../models/owned-relation-write.model';
import { OwnedRelation } from '../models/owned-relation.model';
import { Where } from '../models/where/where-filter.model';
import { OwnedRelationUtilities } from '../owned-relation.utilities';
import { Transaction } from '../transaction/transaction.model';

/**
 * What a write giving rows of its relations hands on to every level of them.
 */
type OwnedRowsWriteOptions = BaseRepositoryOptions & Pick<WriteRelationsOptions<BaseEntity>, 'deletedRelatedRows'>;

/**
 * The values taken off one written row for its relations, the id the row was written under and the
 * tenant it belongs to.
 */
export type OwnedRowsEntry = [Record<string, unknown>, string, string | undefined];

/**
 * Updates rows of another entity's repository, each with values of its own, which only a repository
 * may ask of another.
 */
type UpdateEachOf = (
    repository: Repository<BaseEntity>,
    rows: DeepPartial<BaseEntity>[],
    options: BaseRepositoryOptions
) => Promise<WrittenUpdate<BaseEntity>[]>;

/**
 * Writes and removes the rows of the one to many and has one relations of a repository's entity:
 * the rows a write gives a value for, and the rows that go when their owner does. Each through the
 * repository of its own entity, which runs its hooks, scope, change sets and tenancy on them.
 */
export class OwnedRowWriter<T extends BaseEntity> {
    constructor(
        private readonly entityClass: Newable<T>,
        private readonly dataSource: DataSourceInterface,
        private readonly references: ReferenceValidator<T>,
        private readonly updateEachOf: UpdateEachOf
    ) {}

    /**
     * Whether the data of some rows gives a value for a one to many or has one relation.
     * @param rows - The data of the rows.
     * @returns True when one of them does.
     */
    hasRows(rows: DeepPartial<T>[]): boolean {
        return OwnedRelationUtilities.resolveAll(this.entityClass).some(r => rows.some(row => Reflect.get(row, r.key) !== undefined));
    }

    /**
     * Takes the values of the one to many and has one relations off the data of the rows being
     * written.
     *
     * Before anything else runs on the data: those rows are written through the repository of their
     * own entity once these exist, which runs its hooks, scope, change sets and tenancy on them. Left
     * on, the repository's hooks would have run on them as well, encrypting a value twice.
     * @param rows - The data of the rows, which loses those values.
     * @returns The values taken off each row, in the order of the rows.
     */
    takeRows(rows: DeepPartial<T>[]): Record<string, unknown>[] {
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        return rows.map(row => {
            const taken: Record<string, unknown> = {};
            for (const relation of relations) {
                const value: unknown = Reflect.get(row, relation.key);
                if (value !== undefined) {
                    taken[relation.key] = value;
                    Reflect.deleteProperty(row, relation.key);
                }
            }
            return taken;
        });
    }

    /**
     * Writes the rows of the one to many and has one relations that written rows gave a value for,
     * through the repository of their entity, as {@link OwnedRelationUtilities} resolves it: rows the
     * value leaves out are deleted or unlinked, rows without an id created, and rows with one updated.
     *
     * Each row given with an id is updated on its own, because each carries values of its own - and
     * finding it is what checks that it is a row the caller may write. Where the write allows ids, a
     * row given with an id no row has yet is created with it instead. A soft deleted one is restored
     * along with it where the write or the relation says so, and refused otherwise.
     * @param entries - The values taken off each written row, with an `id` when the row was updated,
     * the id it was written under and the tenant it belongs to.
     * @param options - The options of the write, holding the transaction it runs in.
     * @param allowId - Whether the write allows choosing ids, as `create` with `allowId` does.
     * @returns The rows written along with each row, by its id and the relation's key.
     */
    async write(entries: OwnedRowsEntry[], options: OwnedRowsWriteOptions | undefined, allowId: boolean): Promise<OwnedRowsById> {
        // the check the row's own data went through, which gives a row created along with it the
        // row's tenant and refuses linking one of another tenant
        await this.references.validate(entries.map(([data, , rowTenant]) => ({ data, rowTenant })), options);
        const res: OwnedRowsById = new Map();
        const childOptions: OwnedRowsWriteOptions = {
            transaction: options?.transaction,
            acrossTenants: options?.acrossTenants,
            // the scopes an array names are this entity's own, which the other entity does not have
            unscoped: options?.unscoped === true ? true : undefined,
            deletedRelatedRows: options?.deletedRelatedRows
        };
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        const values: [Record<string, unknown>, string][] = entries.map(([data, id]) => [data, id]);
        for (const write of OwnedRelationUtilities.resolveWrites(relations, values)) {
            const { relation, ownerIds }: OwnedRelationWrite = write;
            const written: BaseEntity[] = await this.writeRelationRows(write, options, childOptions, allowId);

            for (const ownerId of ownerIds) {
                const owned: Map<string, BaseEntity[]> = res.get(ownerId) ?? new Map<string, BaseEntity[]>();
                owned.set(relation.key, []);
                res.set(ownerId, owned);
            }
            // pushed onto each owner's list rather than copying it per row, which is the square of
            // the rows of one owner (evaluation/01-data-layer M43)
            for (const row of written) {
                res.get(String(Reflect.get(row, relation.foreignKey)))
                    ?.get(relation.key)
                    ?.push(row);
            }
        }
        return res;
    }

    /**
     * Writes the rows of one relation the written rows gave a value for: the rows the value leaves out
     * deleted or unlinked, the new ones created and the stored ones updated.
     * @param write - The rows of the relation, and the rows they belong to.
     * @param options - The options of the write.
     * @param childOptions - The options the rows of the relation are written with.
     * @param allowId - Whether the write allows choosing ids.
     * @returns The rows created and updated.
     */
    private async writeRelationRows(
        write: OwnedRelationWrite,
        options: OwnedRowsWriteOptions | undefined,
        childOptions: OwnedRowsWriteOptions,
        allowId: boolean
    ): Promise<BaseEntity[]> {
        const { relation, rows }: OwnedRelationWrite = write;
        const repository: Repository<BaseEntity> = this.dataSource.getRepository(relation.target);

        const leftOutWhere: Where<BaseEntity> | undefined = OwnedRelationUtilities.resolveLeftOutWhere(write);
        if (leftOutWhere != undefined && relation.leftOut === 'delete') {
            // whatever their locked properties hold: the save that leaves them out decides it
            await repository.deleteAll(
                ModelRegistry.get(relation.target).optimisticLockDescriptor.resolveRegardlessWhere(leftOutWhere),
                childOptions
            );
        }
        if (leftOutWhere != undefined && relation.leftOut === 'unlink') {
            // null rather than undefined, which an update reads as "leave this column alone"
            // eslint-disable-next-line unicorn/no-null
            await repository.updateAll(leftOutWhere, { [relation.foreignKey]: null }, childOptions);
        }

        const given: DeepPartial<BaseEntity>[] = rows.filter(r => r.id != undefined);
        const newIds: Set<string> = allowId
            ? await this.findMissingIds(relation.target, given.map(r => String(r.id)), childOptions.transaction)
            : new Set();
        const created: BaseEntity[] = await repository.createAll(
            rows.filter(r => r.id == undefined || newIds.has(String(r.id))),
            { ...childOptions, allowId }
        );
        // all at once, each with its own values - and found by the write, so the scope applies.
        // Restoring is writing each as a restore does, over the soft deleted rows as well; the
        // rows that are not deleted are written the same either way, so none is read first
        const stored: DeepPartial<BaseEntity>[] = given.filter(r => !newIds.has(String(r.id)));
        const restores: boolean = isSoftDeleteEntityNewable(relation.target)
            && (options?.deletedRelatedRows ?? relation.deletedRows) === 'restore';
        const restoring: OwnedRowsWriteOptions & Record<'deleted', SoftDeletedRows> = { ...childOptions, deleted: 'include' };
        const updated: BaseEntity[] = (restores
            ? await this.updateEachOf(repository, stored.map(r => ({ ...r, deleted: false })), restoring)
            : await this.updateEachOf(repository, stored, childOptions)
        ).map(u => u.entity);
        return [...created, ...updated];
    }

    /**
     * Finds which of the given ids no row of an entity holds, whoever may see it.
     * @param target - The entity.
     * @param ids - The ids.
     * @param transaction - The transaction of the write.
     * @returns The ids no row holds.
     */
    async findMissingIds(target: Newable<BaseEntity>, ids: string[], transaction: Transaction | undefined): Promise<Set<string>> {
        if (!ids.length) {
            return new Set();
        }
        const options: FindAllOptions<BaseEntity> = {
            where: { id: { oneOf: ids } },
            limit: 'all',
            relations: [],
            autoDecrypt: false,
            unscoped: true,
            acrossTenants: true,
            transaction
        };
        // a row that is only marked deleted still holds its id
        const found: BaseEntity[] = isSoftDeleteEntityNewable(target)
            ? await this.dataSource.getRepository(target).findAll({ ...options, deleted: 'include' })
            : await this.dataSource.getRepository(target).findAll(options);
        const existing: Set<string> = new Set(found.map(f => String(f.id)));
        return new Set(ids.filter(id => !existing.has(id)));
    }

    /**
     * Whether the relations written rows are handed back with are answered by the rows the same write
     * wrote along with them, so that nothing has to be read.
     *
     * Only a one to many or has one relation the data of every row gave a value for, and nothing
     * below it: the rows beside those were not part of the write.
     * @param relations - The relations to hand the rows back with.
     * @param written - The written rows.
     * @param ownedRows - The rows written along with each row, by its id.
     * @returns True when the rows at hand answer every relation, which an empty list of them always is.
     */
    answersRelations(relations: FindAllOptions<T>['relations'], written: T[], ownedRows: OwnedRowsById): boolean {
        const tree: RelationTree = EntityRelationsUtilities.resolveTree(relations);
        return [...tree].every(([key, below]) => !below.size && written.every(row => ownedRows.get(String(row.id))?.has(key) === true));
    }

    /**
     * Puts the rows written along with a row on it, where nothing read them already.
     * @param entity - The written row, as it is handed back.
     * @param ownedRows - The rows written along with each row, by its id.
     * @returns The same entity.
     */
    putOnto(entity: T, ownedRows: OwnedRowsById): T {
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        for (const [key, rows] of ownedRows.get(entity.id) ?? []) {
            if (Reflect.get(entity, key) === undefined) {
                Reflect.set(entity, key, relations.some(r => r.key === key && r.holdsOne) ? rows.at(0) : rows);
            }
        }
        return entity;
    }

    /**
     * Deletes the rows of the given relations of rows about to be removed, through the repository of
     * their entity - which deletes the rows of their own relations in turn.
     *
     * Every row of them, whoever may see it: the delete of their owner was allowed, and a row left
     * behind would point at nothing. A soft deleted entity's rows are deleted for good, because a row
     * that is only marked deleted would still point at the owner.
     * @param ownerIds - The ids of the rows about to be removed.
     * @param relations - Their relations that cascade removes.
     * @param transaction - The transaction the removal runs in.
     */
    async remove(ownerIds: string[], relations: OwnedRelation[], transaction: Transaction): Promise<void> {
        const childOptions: BaseRepositoryOptions = { transaction, unscoped: true, acrossTenants: true };
        for (const relation of relations) {
            // whatever their locked properties hold: what the delete was based on was checked on the owner
            const where: Where<BaseEntity> = ModelRegistry.get(relation.target).optimisticLockDescriptor
                .resolveRegardlessWhere(OwnedRelationUtilities.resolveRemovedWithWhere(relation, ownerIds));
            if (isSoftDeleteEntityNewable(relation.target)) {
                await this.dataSource.getRepository(relation.target).deleteAll(where, { ...childOptions, hardDelete: true });
                continue;
            }
            await this.dataSource.getRepository(relation.target).deleteAll(where, childOptions);
        }
    }

    /**
     * Refuses removing rows that rows of the given relations still point at - every row of them,
     * whoever may see it, and soft deleted ones too, which still point at their owner.
     * @param ownerIds - The ids of the rows about to be removed.
     * @param relations - Their relations that do not cascade removes.
     * @param transaction - The transaction the removal runs in.
     * @throws A conflict naming the first relation whose rows still point at one of them.
     */
    async validateNotReferenced(ownerIds: string[], relations: OwnedRelation[], transaction: Transaction): Promise<void> {
        const childOptions: BaseRepositoryOptions = { transaction, unscoped: true, acrossTenants: true };
        for (const relation of relations) {
            const where: Where<BaseEntity> = OwnedRelationUtilities.resolveStillReferencingWhere(relation, ownerIds, this.entityClass);
            const referenced: boolean = isSoftDeleteEntityNewable(relation.target)
                ? await this.dataSource.getRepository(relation.target).exists({ ...childOptions, where, deleted: 'include' })
                : await this.dataSource.getRepository(relation.target).exists({ ...childOptions, where });
            if (referenced) {
                throw new ConflictError(
                    $ts`The ${this.entityClass.name} cannot be deleted while rows of "${relation.key}" still point at it.`
                );
            }
        }
    }
}