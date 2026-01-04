import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Where } from '../where';

/**
 * Options for counting entities.
 */
export type CountOptions<T extends BaseEntity> = BaseRepositoryOptions
    & {
        /**
         * The where filter to count the options by.
         */
        where?: Where<T>
    };