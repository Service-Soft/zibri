import { FindManyOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';
import { Where } from '../where';

export type FindAllOptions<T extends BaseEntity> = BaseRepositoryOptions & OmitStrict<
    FindManyOptions<T>, 'transaction' | 'where'
> & {
    where?: Where<T>
};