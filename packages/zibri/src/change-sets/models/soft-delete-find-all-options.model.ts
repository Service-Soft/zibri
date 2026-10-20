import { SoftDeleteEntity } from './soft-delete-entity.model.ts';
import { SoftDeleteWhere } from './soft-delete-where.model.ts';
import { SoftDeletedRows } from './soft-deleted-rows.type.ts';
import { FindAllOptions } from '../../data-source/models/options/find-all-options.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Options for finding multiple soft delete entities.
 */
export type SoftDeleteFindAllOptions<T extends SoftDeleteEntity> = OmitStrict<FindAllOptions<T>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are found. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};