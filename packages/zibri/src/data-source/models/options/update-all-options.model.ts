import { BulkWriteOptions } from './bulk-write-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

/**
 * Options for updating multiple entities at once.
 */
export type UpdateAllOptions<T extends BaseEntity, R extends boolean = false> = BulkWriteOptions<T> & {
    // should never be allowed, as that would cause typeorm's manager.save method to create new entities instead of updating the existing ones.
    // allowId?: boolean

    /**
     * Whether the updated entities are wanted back, instead of how many there were.
     *
     * A bulk write knows how many entities it changed without looking at any of them, so they are
     * handed back only when they are asked for. Asking for them is bounded the way an unbounded
     * `findAll` is: wanting every entity of a large update is wanting the whole table in memory.
     *
     * They come back with their relations resolved, the ones the entity reads by default included -
     * one read for the whole batch, so a bulk update that hands its rows over is one statement more
     * than one that does not.
     */
    returnUpdated?: R
};