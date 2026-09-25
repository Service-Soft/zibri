import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Where } from '../where/where-filter.model';

/**
 * Options for updating an entity by its id.
 */
export type UpdateByIdOptions<T extends BaseEntity> = BaseRepositoryOptions & WriteRelationsOptions<T> & {
    // should never be allowed, as that would cause typeorm's manager.save method to create a new entity instead of updating the existing one.
    // allowId?: boolean

    /**
     * An additional condition the row has to still meet for the update to happen.
     *
     * Turns the update into a compare and set: `{ blacklisted: false }` alongside
     * `{ blacklisted: true }` claims the row for exactly one caller, and everyone else is told there
     * was nothing to update. Without it two callers who both read the same row both write, and both
     * believe they were the one that changed it.
     *
     * Reach for it whenever the update is only correct because of something you read first. The
     * condition is checked as part of the write rather than before it, so nothing can slip in
     * between - which is the entire point, and is why checking it yourself beforehand is not the
     * same thing.
     */
    where?: Where<T>
};