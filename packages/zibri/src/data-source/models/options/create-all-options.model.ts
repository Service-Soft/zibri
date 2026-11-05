import { BulkWriteOptions } from './bulk-write-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for creating multiple entities.
 */
export type CreateAllOptions<T extends BaseEntity> = BulkWriteOptions<T> & {
    /**
     * Whether each row is created with the id it carries. An id a stored row holds already, deleted
     * or not, is refused with a `UniqueConstraintViolationError`.
     * @default false.
     */
    allowId?: boolean
};