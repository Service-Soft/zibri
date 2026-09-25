import { SoftDeleteEntity } from './soft-delete-entity.model';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';

/**
 * Options for finding a single soft delete entity by its id.
 */
export type SoftDeleteFindByIdOptions<T extends SoftDeleteEntity, Required extends boolean = true> = FindByIdOptions<T, Required> & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};