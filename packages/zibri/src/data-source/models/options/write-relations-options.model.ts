import { BaseEntity } from '../../../entity/base-entity.model';
import { EntityRelations, RelationKeysOf } from '../../../entity/models/entity-relations.model';

/**
 * What every write that hands one row back takes, so that the row is the one finding it by its id
 * would give.
 */
export type WriteRelationsOptions<T extends BaseEntity> = {
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