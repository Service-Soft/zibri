import { SoftDeleteEntity } from './soft-delete-entity.model';
import { FindByIdOptions } from '../../data-source';

/**
 * Options for finding a single soft delete entity by its id.
 */
export type SoftDeleteFindByIdOptions<T extends SoftDeleteEntity> = FindByIdOptions<T> & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};