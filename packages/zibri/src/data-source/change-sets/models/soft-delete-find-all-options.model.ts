import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FindAllOptions } from '../../models/options/find-all-options.model';

/**
 * Options for finding multiple soft delete entities.
 */
export type SoftDeleteFindAllOptions<
    T extends SoftDeleteEntity,
    S extends EntitySelection<T> | undefined = undefined
> = OmitStrict<FindAllOptions<T, S>, 'where'> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are found. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};