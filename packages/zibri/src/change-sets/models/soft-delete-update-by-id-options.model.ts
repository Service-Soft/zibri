import { UpdateByIdOptions } from '../../data-source/models/options/update-by-id-options.model';
import { BaseEntity } from '../../entity/base-entity.model';

/**
 * Options for updating a soft delete entity by its id.
 */
export type SoftDeleteUpdateByIdOptions<T extends BaseEntity> = UpdateByIdOptions<T> & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};