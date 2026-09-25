import { SoftDeleteEntity } from './soft-delete-entity.model';
import { UpdateAllOptions } from '../../data-source/models/options/update-all-options.model';

/**
 * Options for updating multiple soft delete entities at once.
 */
export type SoftDeleteUpdateAllOptions<T extends SoftDeleteEntity, R extends boolean = false> = UpdateAllOptions<T, R> & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};