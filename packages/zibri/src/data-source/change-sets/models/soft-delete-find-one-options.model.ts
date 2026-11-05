import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { FindOneOptions } from '../../models/options/find-one-options.model';

/**
 * Options for finding a single entity.
 */
export type SoftDeleteFindOneOptions<
    T extends SoftDeleteEntity,
    Required extends boolean = true,
    S extends EntitySelection<T> | undefined = undefined
> = OmitStrict<
    FindOneOptions<T, Required, S>,
    'where'
> & {
    /**
     * The where filter to find the options by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are searched. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};