import { SoftDeleteEntity } from './soft-delete-entity.model.ts';
import { SoftDeleteWhere } from './soft-delete-where.model.ts';
import { SoftDeletedRows } from './soft-deleted-rows.type.ts';
import { FindOneOptions } from '../../data-source/models/options/find-one-options.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

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
     * Which soft deleted entities are searched. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};