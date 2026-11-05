import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Where } from '../where/where-filter.model';

/**
 * Options for deleting an entity by its id.
 */
export type DeleteByIdOptions<T extends BaseEntity = BaseEntity> = BaseRepositoryOptions<T>
    & Pick<WriteRelationsOptions<T>, 'relations'>
    & {
        /**
         * A condition the row has to meet as it is deleted, besides its id. A row that is there and no
         * longer meets it is not deleted, and the call fails with a `ConflictError`.
         *
         * A property declaring `optimisticLocking` has to be named here, with the value the delete was
         * based on, or with no value to delete the row regardless.
         */
        where?: Where<T>
    };