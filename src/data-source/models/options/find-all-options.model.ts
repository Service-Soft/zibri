import { FindManyOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Where } from '../where/where-filter.model';

/**
 * Options for finding multiple entities.
 */
export type FindAllOptions<T extends BaseEntity> = BaseRepositoryOptions
    & Pick<FindManyOptions<T>, 'order' | 'skip' | 'take'>
    & {
        /**
         * The where filter to find the options by.
         */
        where?: Where<T>,
        /**
         * The relations to include in the found entities.
         */
        relations?: (keyof T)[]
    };