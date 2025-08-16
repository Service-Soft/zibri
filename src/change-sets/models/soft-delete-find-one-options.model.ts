import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { FindOneOptions } from '../../data-source';
import { OmitStrict } from '../../types';

/**
 * Options for finding a single entity.
 */
export type SoftDeleteFindOneOptions<T extends SoftDeleteEntity> = OmitStrict<FindOneOptions<T>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};