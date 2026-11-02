import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for creating a single entity.
 */
export type CreateOptions<T extends BaseEntity> = BaseRepositoryOptions<T> & WriteRelationsOptions<T> & {
    /**
     * Whether the row is created with the id it carries. An id a stored row holds already, deleted
     * or not, is refused with a `UniqueConstraintViolationError`.
     * @default false.
     */
    allowId?: boolean
};