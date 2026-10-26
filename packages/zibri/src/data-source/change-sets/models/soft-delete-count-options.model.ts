import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { GroupKeysOf } from '../../models/aggregate.model';
import { CountOptions } from '../../models/options/count-options.model';

/**
 * Options for counting soft delete entities, or asking whether any exists.
 */
export type SoftDeleteCountOptions<
    T extends SoftDeleteEntity,
    G extends readonly GroupKeysOf<T>[] | undefined = undefined
> = OmitStrict<CountOptions<T, G>, 'where'> & {
    /**
     * The where filter to count the entities by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are counted. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};