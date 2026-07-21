import { UpdateByIdOptions } from '../../data-source/models/options/update-by-id-options.model';

/**
 * Options for updating a soft delete entity by its id.
 */
export type SoftDeleteUpdateByIdOptions = UpdateByIdOptions & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};