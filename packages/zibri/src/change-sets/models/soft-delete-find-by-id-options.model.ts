import { SoftDeleteEntity } from './soft-delete-entity.model';
import { SoftDeletedRows } from './soft-deleted-rows.type';
import { FindByIdOptions } from '../../data-source/models/options/find-by-id-options.model';
import { EntitySelection } from '../../entity/models/entity-selection.model';

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