import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { EntitySelection } from '../../../entity/models/entity-selection.model';
import { FindByIdOptions } from '../../models/options/find-by-id-options.model';

/**
 * Options for finding a single soft delete entity by its id.
 */
export type SoftDeleteFindByIdOptions<
    T extends SoftDeleteEntity,
    Required extends boolean = true,
    S extends EntitySelection<T> | undefined = undefined
> = FindByIdOptions<T, Required, S> & {
    /**
     * Whether the entity is found when it is soft deleted, or only then. `exclude` when it is not
     * given.
     */
    deleted?: SoftDeletedRows
};