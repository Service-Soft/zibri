import { UpdateAllOptions } from '../../data-source';

/**
 * Options for updating multiple soft delete entities at once.
 */
export type SoftDeleteUpdateAllOptions = UpdateAllOptions & {
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};