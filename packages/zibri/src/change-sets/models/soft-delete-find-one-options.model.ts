import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { FindOneOptions } from '../../data-source/models/options/find-one-options.model';
import { OmitStrict } from '../../types/omit-strict.type';

/**
 * Options for finding a single entity.
 */
export type SoftDeleteFindOneOptions<T extends SoftDeleteEntity, Required extends boolean = true> = OmitStrict<
    FindOneOptions<T, Required>,
    'where'
> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Whether or not soft deleted entities should be included.
     */
    withDeleted?: boolean
};