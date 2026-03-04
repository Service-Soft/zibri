import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { FindAllOptions } from '../../data-source/models/options/find-all-options.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Options for finding multiple soft delete entities.
 */
export type SoftDeleteFindAllOptions<T extends SoftDeleteEntity> = OmitStrict<FindAllOptions<T>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};