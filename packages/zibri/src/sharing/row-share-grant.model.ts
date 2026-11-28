import { type BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';

/**
 * A row to share, and the role to share it in, as an invitation carries it.
 */
export type RowShareGrant = {
    /**
     * The shareable entity the row is of.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * The id of the row.
     */
    rowId: string,
    /**
     * The role, one of those the entity declares.
     */
    role: string
};