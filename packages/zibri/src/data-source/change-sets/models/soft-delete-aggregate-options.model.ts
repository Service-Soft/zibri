import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { OmitStrict } from '../../../types/omit-strict.type';
import { AggregateOptions, GroupKeysOf } from '../../models/aggregate.model';

/**
 * Options for taking a value over soft delete entities.
 */
export type SoftDeleteAggregateOptions<
    T extends SoftDeleteEntity,
    G extends readonly GroupKeysOf<T>[] | undefined = undefined
> = OmitStrict<AggregateOptions<T, G>, 'where'> & {
    /**
     * The where filter the entities are taken from.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are taken into account. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};