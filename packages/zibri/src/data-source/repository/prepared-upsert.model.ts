import { BaseEntity } from '../../entity/base-entity.model';
import { UpsertRow } from '../models/upsert-row.model';

/**
 * One row of an upsert as it is handed to the store, with what is left to judge once it is written.
 */
export type PreparedUpsert<T extends BaseEntity> = {
    /**
     * The row in the form it is stored in, and its changes on a conflict.
     */
    row: UpsertRow<T>,
    /**
     * The properties the scope reads that the conflict path adds an amount to, whose result is only
     * known once the row is written.
     */
    incremented: string[],
    /**
     * The values the conflict path sets that are encrypted bound to their row, as the caller gave
     * them. Written once the row is, since the row they bind to is the one already holding the
     * identity. Undefined when there are none.
     */
    bound: Record<string, unknown> | undefined
};