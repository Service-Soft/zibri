import { FindOneOptions as TOFindOneOptions } from 'typeorm';

import { BaseRepositoryOptions } from './base-repository-options.model';
import { BaseEntity } from '../../../entity';
import { OmitStrict } from '../../../types';
import { Where } from '../where';

export type FindOneOptions<T extends BaseEntity> = BaseRepositoryOptions
    & OmitStrict<TOFindOneOptions<T>, 'where'> & {
        where?: Where<T>
    };