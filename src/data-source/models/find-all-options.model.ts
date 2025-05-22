import { FindManyOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../entity';
import { OmitStrict } from '../../types';

export type FindAllOptions<T extends BaseEntity> = OmitStrict<FindManyOptions<T>, 'transaction'> & BaseRepositoryOptions;