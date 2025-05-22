import { FindOneOptions as TOFindOneOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../entity';

export type FindOneOptions<T extends BaseEntity> = BaseRepositoryOptions & TOFindOneOptions<T>;