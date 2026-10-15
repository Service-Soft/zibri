import { OwnedRelationWrite } from './models/owned-relation-write.model';
import { OwnedRelation } from './models/owned-relation.model';
import { Where } from './models/where/where-filter.model';
import { BaseEntity } from '../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { Relation } from '../entity/models/relation.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';

// Shared by every store, because what saving an owner does to the rows of its one to many and has one
// relations is part of the contract rather than of any one implementation: a store answering
// differently makes the same save delete a row on one and keep it on another. Each store only does
// the writes this resolves, in its own way and inside its own transaction.
/**
 * Resolves what saving and deleting a row does with the rows of its one to many and has one
 * relations.
 */
export class OwnedRelationUtilities {

    /**
     * Resolves the one to many and has one relations of an entity.
     * @param entityClass - The entity owning them.
     * @returns Each relation, with what saving and deleting an owner does to its rows.
     * @throws When the inverse side of one of them is not a to one relation with a join column.
     */
    static resolveAll(entityClass: Newable<BaseEntity>): OwnedRelation[] {
        const res: OwnedRelation[] = [];
        for (const [key, metadata] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entityClass))) {
            if (metadata.type !== Relation.ONE_TO_MANY && metadata.type !== Relation.HAS_ONE) {
                continue;
            }
            const target: Newable<BaseEntity> = metadata.target();
            const targetProperties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(target);
            const inverse: PropertyMetadata | undefined = targetProperties[metadata.inverseSide];
            // an inverse that is a plain column - the id a change set carries of its entity - is no
            // foreign key: the sql schema has no constraint for it, so nothing is saved or deleted
            // through it here. What happens to such rows is the business of whoever declared them
            if (!isRelationMetadata(inverse)) {
                continue;
            }
            if ((inverse.type !== Relation.MANY_TO_ONE && inverse.type !== Relation.BELONGS_TO_ONE) || inverse.joinColumn == undefined) {
                throw new InternalError(
                    `The relation "${entityClass.name}.${key}" needs "${target.name}.${metadata.inverseSide}" `
                    + 'to be a to one relation with "joinColumn" set.'
                );
            }

            // the flags of both sides count, the same way the sql schema reads them
            const hasFlag: (flag: 'insert' | 'update' | 'remove') => boolean = flag => this.hasCascadeFlag(metadata.cascade, flag)
                || this.hasCascadeFlag(inverse.cascade, flag);
            // the column decides whether the key can be empty when it is declared, the relation
            // otherwise - as for the column of the sql schema. A required that is a function is
            // decided per request, which a column cannot be, so it is not required there either
            const keyMetadata: PropertyMetadata = targetProperties[inverse.joinColumn] ?? inverse;
            res.push({
                key,
                holdsOne: metadata.type === Relation.HAS_ONE,
                target,
                foreignKey: inverse.joinColumn,
                cascadesInsert: hasFlag('insert'),
                cascadesUpdate: hasFlag('update'),
                cascadesRemove: hasFlag('remove'),
                leftOut: keyMetadata.required === true ? 'delete' : 'unlink'
            });
        }
        return res;
    }

    /**
     * Resolves what saving the given owners writes to the rows of their relations.
     *
     * Only relations that cascade inserts write anything, and only for owners whose data gives a
     * value for them: `undefined` leaves the rows alone, while `null` and an empty list leave every
     * row out.
     * @param relations - The relations of the owners, as {@link resolveAll} resolved them.
     * @param entries - The values each owner gives for them, with an `id` when the owner was given
     * with one, and the id it is saved under.
     * @returns One write per relation that some owner gives a value for.
     */
    static resolveWrites(relations: OwnedRelation[], entries: [Record<string, unknown>, string][]): OwnedRelationWrite[] {
        const res: OwnedRelationWrite[] = [];
        for (const relation of relations) {
            if (!relation.cascadesInsert) {
                continue;
            }
            const write: OwnedRelationWrite = { relation, rows: [], ownerIds: [], updatedOwnerIds: [], keptIds: [] };
            for (const [entry, id] of entries) {
                const value: unknown = entry[relation.key];
                if (value === undefined) {
                    continue;
                }
                write.ownerIds.push(id);
                if (entry['id'] != undefined) {
                    write.updatedOwnerIds.push(id);
                }
                for (const row of this.toRows(value)) {
                    write.rows.push(this.toOwnedRow(row, relation, id, write.keptIds));
                }
            }
            if (write.ownerIds.length) {
                res.push(write);
            }
        }
        return res;
    }

    /**
     * Resolves the filter finding the rows a write leaves out: rows of the owners that were updated,
     * which the value they were given does not name.
     * @param write - The write, as {@link resolveWrites} resolved it.
     * @returns The filter, or undefined when no owner was updated and so none can have held a row.
     */
    static resolveLeftOutWhere(write: OwnedRelationWrite): Where<BaseEntity> | undefined {
        if (!write.updatedOwnerIds.length) {
            return undefined;
        }
        const where: Record<string, unknown> = { [write.relation.foreignKey]: { oneOf: write.updatedOwnerIds } };
        if (write.keptIds.length) {
            where['id'] = { notOneOf: write.keptIds };
        }
        return where;
    }

    /**
     * Resolves the filter finding the rows a relation deletes along with the given owners.
     * @param relation - The relation, which cascades removes.
     * @param ownerIds - The ids of the owners being deleted.
     * @returns The filter.
     */
    static resolveRemovedWithWhere(relation: OwnedRelation, ownerIds: string[]): Where<BaseEntity> {
        return { [relation.foreignKey]: { oneOf: ownerIds } };
    }

    /**
     * Reads the rows a value of a relation gives.
     * @param value - The value, which is defined.
     * @returns Its rows: none for `null`, the list for a list, and the row itself otherwise.
     */
    private static toRows(value: unknown): DeepPartial<BaseEntity>[] {
        if (value === null) {
            return [];
        }
        const rows: unknown[] = Array.isArray(value) ? value : [value];
        return rows.filter((row): row is DeepPartial<BaseEntity> => typeof row === 'object' && row != null);
    }

    /**
     * Builds the row that is saved for one row of a relation's value.
     * @param row - The row as it was given.
     * @param relation - The relation.
     * @param ownerId - The id of its owner.
     * @param keptIds - Where the id of a row given with one is collected.
     * @returns The row with its foreign key set, and with nothing else when it has an id and the
     * relation does not cascade updates.
     */
    private static toOwnedRow(
        row: DeepPartial<BaseEntity>,
        relation: OwnedRelation,
        ownerId: string,
        keptIds: string[]
    ): DeepPartial<BaseEntity> {
        if (row.id == undefined) {
            return { ...row, [relation.foreignKey]: ownerId };
        }
        keptIds.push(String(row.id));
        return relation.cascadesUpdate
            ? { ...row, [relation.foreignKey]: ownerId }
            : { id: row.id, [relation.foreignKey]: ownerId };
    }

    private static hasCascadeFlag(cascade: RelationMetadata<BaseEntity>['cascade'], flag: 'insert' | 'update' | 'remove'): boolean {
        return cascade === true || (Array.isArray(cascade) && cascade.includes(flag));
    }
}
