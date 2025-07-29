import { BaseRepositoryOptions } from './base-repository-options.model';

/**
 * Options for updating an entity by its id.
 */
export type UpdateByIdOptions = BaseRepositoryOptions & {
    /**
     * Whether or not setting the id property manually is allowed.
     * @default false.
     */
    allowId?: boolean
};