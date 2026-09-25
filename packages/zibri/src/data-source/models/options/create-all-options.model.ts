import { BulkWriteOptions } from './bulk-write-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for creating multiple entities.
 */
export type CreateAllOptions<T extends BaseEntity> = BulkWriteOptions<T> & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};