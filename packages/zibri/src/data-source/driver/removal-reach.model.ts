import { BaseEntity } from '../../entity/base-entity.model';
import { type RelatedNarrowing } from '../models/related-narrowing.model';
import { Where } from '../models/where/where-filter.model';

/**
 * What the rows a delete removes have to match as they are removed: the caller's reach, judged in
 * the same window as the removal, not by the read that found them.
 */
export type RemovalReach<T extends BaseEntity> = {
    /**
     * The rows the caller may delete.
     */
    where: Where<T>,
    /**
     * What the rows of each entity the filter reaches through a relation are narrowed to.
     */
    related: RelatedNarrowing | undefined,
    /**
     * Whether every one of the rows is removed or none of them: a row that is gone, or out of reach
     * by the time it would be removed, then keeps the others from being removed as well.
     */
    wholly: boolean
};