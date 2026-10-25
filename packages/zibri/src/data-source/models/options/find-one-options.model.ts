import { BaseRepositoryOptions } from './base-repository-options.model';
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { EntitySelection } from '../../../entity/models/entity-selection.model';

/**
 * Options for finding a single entity.
 */
export type FindOneOptions<
    T extends BaseEntity,
    Required extends boolean = true,
    S extends EntitySelection<T> | undefined = undefined
> = BaseRepositoryOptions
    & Pick<FindAllOptions<T, S>, 'where' | 'relations' | 'autoDecrypt' | 'select'>
    & {
        // true by default: reading one specific row that is not there is usually a bug and not a
        // result, so it throws unless the caller says a missing row is an answer
        /**
         * Whether or not a result is required. Defaults to true.
         *
         * Set it to false to receive undefined instead of a thrown error. The return type follows,
         * so a caller that allows nothing to be found has to handle that case.
         */
        required?: Required
    };