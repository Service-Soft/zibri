import { SoftDeleteEntity } from './soft-delete-entity.model';
import { WhereFilter } from '../../data-source';
import { OmitStrict } from '../../types';

/**
 * A single where filter for a soft delete entity.
 */
export type SoftDeleteWhereFilter<T extends SoftDeleteEntity> = OmitStrict<WhereFilter<T>, 'deleted'>;

/**
 * The type for a soft delete where property. Can either be a single where filter or an array of where filters.
 */
export type SoftDeleteWhere<T extends SoftDeleteEntity> = SoftDeleteWhereFilter<T> | SoftDeleteWhereFilter<T>[];