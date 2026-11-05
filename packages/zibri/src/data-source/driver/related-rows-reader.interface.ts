import { BaseEntity } from '../../entity/base-entity.model';
import { RelationMetadata } from '../../entity/decorators/property.decorator';
import { RelationTree } from '../../entity/models/entity-relations.model';
import { Newable } from '../../types/newable.type';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * What a driver reads its related rows with, for the relations to be resolved the same way on every
 * store.
 */
export interface RelatedRowsReader {
    /**
     * Reads the rows of an entity matching a filter, with the relations below resolved and narrowed
     * the same way.
     * @param target - The entity.
     * @param where - The filter, already narrowed to the rows the caller may see.
     * @param below - The relations to resolve on the rows.
     * @param related - What the rows the relations below reach are narrowed to.
     * @param transaction - The transaction to read through.
     * @returns The matching rows.
     */
    findRelated: (
        target: Newable<BaseEntity>,
        where: Where<BaseEntity>,
        below: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ) => Promise<BaseEntity[]>,

    /**
     * Reads the ids a many to many relation holds for each of the given rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param transaction - The transaction to read through.
     * @returns The ids, a list per row in the order the rows were given.
     */
    findRelatedIds: (
        entities: BaseEntity[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        transaction: Transaction | undefined
    ) => Promise<string[][]>
}