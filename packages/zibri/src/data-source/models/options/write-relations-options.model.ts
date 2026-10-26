import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityRelations, RelationKeysOf } from '../../../entity/models/entity-relations.model';
import { DeletedRelatedRows } from '../deleted-related-rows.type';

/**
 * What every write that can give rows of its relations takes: what it does with a soft deleted one,
 * and which relations the row it hands back carries.
 */
export type WriteRelationsOptions<T extends BaseEntity> = {
    /**
     * What the write does with a soft deleted row it is given by its id, as a row of a `oneToMany` or
     * `hasOne` relation, at every level it writes. Falls back to the `deletedRows` of each relation.
     */
    deletedRelatedRows?: DeletedRelatedRows,
    /**
     * The relations to resolve on the row that comes back.
     *
     * Falls back to the entity's `defaultRelations`, the same as every read does. They are read once
     * the row has been written rather than as part of writing it, because a relation lives in rows
     * beside this one - so asking for one is asking for a second round trip, and asking for none
     * leaves the write to answer on its own.
     *
     * A relation of a relation is asked for by naming it in turn, `{ album: { artist: true } }`, and
     * every level is one read of its own.
     */
    relations?: EntityRelations<T> | RelationKeysOf<T>[]
};