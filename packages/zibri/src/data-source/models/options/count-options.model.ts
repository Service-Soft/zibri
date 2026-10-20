import { BaseRepositoryOptions } from './base-repository-options.model.ts';
import { FindAllOptions } from './find-all-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

/**
 * Options for counting entities.
 */
export type CountOptions<T extends BaseEntity> = BaseRepositoryOptions
    & Pick<FindAllOptions<T>, 'where'>;