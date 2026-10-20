import { BaseRepositoryOptions } from './base-repository-options.model.ts';
import { WriteRelationsOptions } from './write-relations-options.model.ts';
import { BaseEntity } from '../../../entity/base-entity.model.ts';

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