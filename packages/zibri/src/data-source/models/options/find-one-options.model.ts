import { BaseRepositoryOptions } from './base-repository-options.model';
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for finding a single entity.
 */
export type FindOneOptions<T extends BaseEntity, Required extends boolean = true> = BaseRepositoryOptions
    & Pick<FindAllOptions<T>, 'where' | 'relations' | 'autoDecrypt'>
    & {
        /**
         * Whether or not a result is required. Defaults to true.
         *
         * Set it to false to receive undefined instead of a thrown error. The return type follows,
         * so a caller that allows nothing to be found has to handle that case.
         */
        required?: Required
    };