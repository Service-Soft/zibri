import { BaseRepositoryOptions } from './base-repository-options.model';
import { FindAllOptions } from './find-all-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { GroupKeysOf } from '../aggregate.model';

/**
 * Options for counting entities.
 */
export type CountOptions<T extends BaseEntity, G extends readonly GroupKeysOf<T>[] | undefined = undefined> = BaseRepositoryOptions
    & Pick<FindAllOptions<T>, 'where'>
    & {
        /**
         * The properties to count per group of, instead of counting every row.
         *
         * The answer is then one row per group, holding the values the group shares and `count`, in
         * no order.
         */
        groupBy?: G
    };