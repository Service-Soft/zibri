import { SoftDeleteEntity } from './soft-delete-entity.model.ts';
import { SoftDeleteWhere } from './soft-delete-where.model.ts';
import { SoftDeletedRows } from './soft-deleted-rows.type.ts';
import { CountOptions } from '../../data-source/models/options/count-options.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';

/**
 * Options for counting soft delete entities, or asking whether any exists.
 */
export type SoftDeleteCountOptions<T extends SoftDeleteEntity> = OmitStrict<CountOptions<T>, 'where'> & {
    /**
     * The where filter to count the entities by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are counted. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};