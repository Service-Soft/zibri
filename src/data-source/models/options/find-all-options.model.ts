import { FindManyOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';
import { Where } from '../where';

/**
 * Options for finding multiple entities.
 */
export type FindAllOptions<T extends BaseEntity> = BaseRepositoryOptions & OmitStrict<
    FindManyOptions<T>, 'transaction' | 'where'
> & {
    /**
     * The where filter to find the options by.
     */
    where?: Where<T>
};