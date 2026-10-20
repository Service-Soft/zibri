import { BaseRepositoryOptions } from './base-repository-options.model.ts';
import { WriteRelationsOptions } from './write-relations-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';
import { Where } from '../where/where-filter.model.ts';

/**
 * Options for inserting a row or changing the one that already holds the identity.
 */
export type UpsertOptions<T extends BaseEntity> = BaseRepositoryOptions & WriteRelationsOptions<T> & {
    /**
     * What the row already holding the identity has to match for `onConflict` to apply, eg. The value
     * a property declaring `optimisticLocking` had when it was read. When it does not match, nothing
     * is written and the call fails with a `ConflictError`.
     */
    where?: Where<T>
};