import { SoftDeleteEntity } from './soft-delete-entity.model.ts';
import { SoftDeletedRows } from './soft-deleted-rows.type.ts';
import { UpdateAllOptions } from '../../data-source/models/options/update-all-options.model.ts';

/**
 * Options for updating multiple soft delete entities at once.
 */
export type SoftDeleteUpdateAllOptions<T extends SoftDeleteEntity, R extends boolean = false> = UpdateAllOptions<T, R> & {
    /**
     * Which soft deleted entities are updated. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};