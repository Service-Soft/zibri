import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';

/**
 * Options for finding a single soft delete entity by its id.
 */
export type SoftDeleteFindByIdOptions<T extends SoftDeleteEntity, Required extends boolean = true> = FindByIdOptions<T, Required> & {
    /**
     * Whether the entity is found when it is soft deleted, or only then. `exclude` when it is not
     * given.
     */
    deleted?: SoftDeletedRows
};