import { FindOneOptions as TOFindOneOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';
import { Where } from '../where';

/**
 * Options for finding a single entity.
 */
export type FindOneOptions<T extends BaseEntity> = BaseRepositoryOptions
    & OmitStrict<TOFindOneOptions<T>, 'where' | 'transaction'> & {
        /**
         * The where filter to find the entity by.
         */
        where?: Where<T>
    };