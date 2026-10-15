import { OwnedRelation } from './owned-relation.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';

/**
 * What saving some owners writes to the rows of one of their relations.
 */
export type OwnedRelationWrite = {
    /**
     * The relation.
     */
    relation: OwnedRelation,
    /**
     * The rows to save, each with its foreign key set to its owner. A row given with an id carries
     * nothing else when the relation does not cascade updates.
     */
    rows: DeepPartial<BaseEntity>[],
    /**
     * The owners whose data gives a value for the relation, by their id.
     */
    ownerIds: string[],
    /**
     * The owners among them that were given with an id, and so may already hold rows the value
     * leaves out.
     */
    updatedOwnerIds: string[],
    /**
     * The ids of the rows the value gives, which stay with an owner whatever it held before.
     */
    keptIds: string[]
};