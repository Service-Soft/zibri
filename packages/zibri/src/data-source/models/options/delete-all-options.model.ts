import { BulkWriteOptions } from './bulk-write-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

/**
 * Options for deleting multiple entities.
 */
export type DeleteAllOptions<T extends BaseEntity, R extends boolean = false> = BulkWriteOptions<T> & {
    /**
     * Whether to return the deleted entities, instead of how many there were.
     *
     * Bounded the way an unbounded `findAll` is: wanting every entity of a large delete handed back
     * is wanting the whole table in memory.
     *
     * They come back with their relations resolved, the ones the entity reads by default included.
     * The rows are read on their way out, so that costs nothing a delete was not already paying.
     */
    returnDeleted?: R
};