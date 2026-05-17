import { BaseRepositoryOptions } from './base-repository-options.model';
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for counting entities.
 */
export type CountOptions<T extends BaseEntity> = BaseRepositoryOptions
    & Pick<FindAllOptions<T>, 'where'>;