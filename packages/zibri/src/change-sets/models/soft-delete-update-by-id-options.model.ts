import { SoftDeletedRows } from './soft-deleted-rows.type';
import { UpdateByIdOptions } from '../../data-source/models/options/update-by-id-options.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * Options for updating a soft delete entity by its id.
 */
export type SoftDeleteUpdateByIdOptions<T extends BaseEntity> = UpdateByIdOptions<T> & {
    /**
     * Whether the entity is updated when it is soft deleted, or only then. `exclude` when it is not
     * given.
     */
    deleted?: SoftDeletedRows
};