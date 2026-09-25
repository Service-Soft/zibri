import { BaseRepositoryOptions } from './base-repository-options.model';
import { WriteRelationsOptions } from './write-relations-options.model';
import { BaseEntity } from '../../../entity/base-entity.model';

/**
 * Options for creating a single entity.
 */
export type CreateOptions<T extends BaseEntity> = BaseRepositoryOptions & WriteRelationsOptions<T> & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};