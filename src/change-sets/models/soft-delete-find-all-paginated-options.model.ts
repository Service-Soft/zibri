import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { FindAllPaginatedOptions } from '../../data-source';
import { OmitStrict } from '../../types';

/**
 * Options for finding soft delete entities in paginated form.
 */
export type SoftDeleteFindAllPaginatedOptions<T extends SoftDeleteEntity> = OmitStrict<FindAllPaginatedOptions<T>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};