import { UpdateByIdOptions } from '../../data-source';

/**
 * Options for updating a soft delete entity by its id.
 */
export type SoftDeleteUpdateByIdOptions = UpdateByIdOptions & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};