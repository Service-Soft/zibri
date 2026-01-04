import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Where } from '../where';

/**
 * Options for finding a single entity.
 */
export type FindOneOptions<T extends BaseEntity> = BaseRepositoryOptions
    & {
        /**
         * The where filter to find the entity by.
         */
        where?: Where<T>,
        /**
         * The relations to include in the found entity.
         */
        relations?: (keyof T)[]
    };