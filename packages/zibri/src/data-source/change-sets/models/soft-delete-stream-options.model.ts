import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeleteWhere } from './soft-delete-where.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { OmitStrict } from '../../../types/omit-strict.type';
import { StreamOptions } from '../../models/options/stream-options.model';

/**
 * Options for streaming soft delete entities.
 */
export type SoftDeleteStreamOptions<
    T extends SoftDeleteEntity,
    S extends EntitySelection<T> | undefined = undefined
> = OmitStrict<StreamOptions<T, S>, 'where'> & {
    /**
     * The where filter to stream the entities by.
     */
    where?: SoftDeleteWhere<T>,
    /**
     * Which soft deleted entities are streamed. `exclude` when it is not given.
     */
    deleted?: SoftDeletedRows
};