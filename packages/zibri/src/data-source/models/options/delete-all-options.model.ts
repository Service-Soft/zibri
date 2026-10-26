import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for deleting multiple entities.
 *
 * A property declaring `optimisticLocking` has to be named in the filter of the delete, with the value
 * the delete was based on, or with no value to delete the rows regardless.
 */
export type DeleteAllOptions<T extends BaseEntity, R extends boolean = false> = BaseRepositoryOptions & Pick<WriteRelationsOptions<T>, 'relations'> & {
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