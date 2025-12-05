import { FindOneOptions as TOFindOneOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { OmitStrict } from '../../../types';
import { Where } from '../where';

/**
 * Options for finding a single entity.
 */
export type FindOneOptions<T extends BaseEntity> = BaseRepositoryOptions
    & OmitStrict<TOFindOneOptions<T>, 'where' | 'transaction' | 'relations' | 'withDeleted'> & {
        /**
         * The where filter to find the entity by.
         */
        where?: Where<T>,
        /**
         * The relations to include in the found entity.
         */
        relations?: (keyof T)[]
    };