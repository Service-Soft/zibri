import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';

/**
 * A row an action writes, as its `describe` names it: the entity, the row as it is stored and what the action writes
 * to it. The approval request shows the values it changes, and is refused on approval once the stored row changed.
 */
export type ApprovalRowChange = {
    /**
     * The entity of the row, such as `Task`.
     */
    entity: Newable<BaseEntity>,
    /**
     * The row as it is stored, read through its repository, or undefined for a row the action creates.
     */
    stored: BaseEntity | undefined,
    /**
     * The values the action writes to the row, or null when it deletes it.
     */
    values: object | null
};