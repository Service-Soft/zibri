import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FindAllPaginatedOptions } from '../../models/options/find-all-paginated-options.model';

/**
 * Options for finding soft delete entities in paginated form.
 */
export type SoftDeleteFindAllPaginatedOptions<
    T extends SoftDeleteEntity,
    S extends EntitySelection<T> | undefined = undefined
> = OmitStrict<FindAllPaginatedOptions<T, S>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are paged through. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};