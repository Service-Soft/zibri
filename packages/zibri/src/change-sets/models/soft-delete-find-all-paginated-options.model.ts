import { SoftDeleteEntity } from './soft-delete-entity.model.ts';
import { SoftDeleteWhere } from './soft-delete-where.model.ts';
import { SoftDeletedRows } from './soft-deleted-rows.type.ts';
import { FindAllPaginatedOptions } from '../../data-source/models/options/find-all-paginated-options.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Options for finding soft delete entities in paginated form.
 */
export type SoftDeleteFindAllPaginatedOptions<T extends SoftDeleteEntity> = OmitStrict<FindAllPaginatedOptions<T>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are paged through. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};